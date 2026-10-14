import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createClient} from '@supabase/supabase-js';

const {SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY,SUPABASE_ANON_KEY,OWNER_EMAIL,PORT=10000,PUBLIC_BASE_URL} = process.env;
for(const [k,v] of Object.entries({SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY,SUPABASE_ANON_KEY,OWNER_EMAIL})) if(!v) throw new Error(`Missing ${k}`);
const db=createClient(SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const authClient=createClient(SUPABASE_URL,SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const app=express(); app.disable('x-powered-by'); app.use(helmet({contentSecurityPolicy:false})); app.use(express.json({limit:'24kb'}));
app.use('/api',rateLimit({windowMs:15*60*1000,limit:120,standardHeaders:'draft-7',legacyHeaders:false}));
app.use('/api/bookings',rateLimit({windowMs:60*60*1000,limit:20,standardHeaders:'draft-7',legacyHeaders:false}));
const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'public');
const fail=(res,status,message)=>res.status(status).json({error:message});
const err=(res,e)=>{console.error(e);return fail(res,500,'Something went wrong. Please try again.');};
const iso=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const clean=(s,max=120)=>typeof s==='string'?s.trim().slice(0,max):'';
const uuid=s=>typeof s==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const tokenHash=t=>crypto.createHash('sha256').update(t).digest('hex');
async function owner(req,res,next){const jwt=(req.headers.authorization||'').match(/^Bearer (.+)$/)?.[1];if(!jwt)return fail(res,401,'Sign in required');const {data,error}=await authClient.auth.getUser(jwt);if(error||!data.user||data.user.email?.toLowerCase()!==OWNER_EMAIL.toLowerCase()||!data.user.email_confirmed_at)return fail(res,403,'Owner access required');next();}
async function availability(start,end){const [{data:vehicles,error:e1},{data:booked,error:e2},{data:blocks,error:e3}]=await Promise.all([
 db.from('vehicles').select('id,name,category,ac,seats,description,active').eq('active',true).order('name'),
 db.from('bookings').select('vehicle_id').eq('status','approved').lte('start_date',end).gte('end_date',start),
 db.from('vehicle_blocks').select('vehicle_id').lte('start_date',end).gte('end_date',start)
]);if(e1||e2||e3)throw(e1||e2||e3);const unavailable=new Set([...booked,...blocks].map(x=>x.vehicle_id));return vehicles.map(v=>({...v,available:!unavailable.has(v.id)}));}
app.get('/api/config',(req,res)=>res.json({supabaseUrl:SUPABASE_URL,anonKey:SUPABASE_ANON_KEY}));
app.get('/api/vehicles',async(req,res)=>{try{const {start,end}=req.query;if(start||end){if(!iso(start)||!iso(end)||start>end)return fail(res,400,'Choose valid dates');return res.json(await availability(start,end));}const {data,error}=await db.from('vehicles').select('id,name,category,ac,seats,description').eq('active',true).order('name');if(error)throw error;res.json(data);}catch(e){err(res,e)}});
app.post('/api/bookings',async(req,res)=>{try{const b=req.body||{};const name=clean(b.name,80),phone=clean(b.phone,18),pickup=clean(b.pickup),destination=clean(b.destination),notes=clean(b.notes,500);const passengers=Number(b.passengers);
if(name.length<2||!/^[+\d\s()-]{10,18}$/.test(phone)||pickup.length<2||destination.length<2||!iso(b.start)||!iso(b.end)||b.end<b.start||b.start<new Date().toISOString().slice(0,10)||!['One Way','Round Trip'].includes(b.tripType)||!uuid(b.vehicleId)||!Number.isInteger(passengers)||passengers<1||passengers>30)return fail(res,400,'Check booking details');
const list=await availability(b.start,b.end);const vehicle=list.find(v=>v.id===b.vehicleId);if(!vehicle||!vehicle.available||passengers>vehicle.seats)return fail(res,409,'Vehicle unavailable or too small');
const accessToken=crypto.randomBytes(24).toString('hex');const reference='SHY-'+crypto.randomBytes(5).toString('hex').toUpperCase();
const {error}=await db.from('bookings').insert({reference,access_token_hash:tokenHash(accessToken),customer_name:name,phone,pickup,destination,start_date:b.start,end_date:b.end,trip_type:b.tripType,passengers,vehicle_id:b.vehicleId,notes});if(error)throw error;
const base=(PUBLIC_BASE_URL||`${req.protocol}://${req.get('host')}`).replace(/\/$/,'');res.status(201).json({reference,status:'pending',trackingUrl:`${base}/status.html?ref=${encodeURIComponent(reference)}&token=${accessToken}`});}catch(e){err(res,e)}});
app.get('/api/bookings/status',async(req,res)=>{try{const reference=clean(req.query.ref,30),token=clean(req.query.token,100);if(!/^SHY-[A-F0-9]{10}$/.test(reference)||!/^[a-f0-9]{48}$/.test(token))return fail(res,400,'Invalid tracking link');const {data,error}=await db.from('bookings').select('reference,status,pickup,destination,start_date,end_date,trip_type,created_at').eq('reference',reference).eq('access_token_hash',tokenHash(token)).maybeSingle();if(error)throw error;if(!data)return fail(res,404,'Booking not found');res.json(data);}catch(e){err(res,e)}});
app.get('/api/admin/summary',owner,async(req,res)=>{try{const [a,b,c]=await Promise.all([db.from('vehicles').select('*').order('name'),db.from('bookings').select('*,vehicles(name)').order('created_at',{ascending:false}).limit(300),db.from('vehicle_blocks').select('*,vehicles(name)').order('start_date',{ascending:false}).limit(200)]);if(a.error||b.error||c.error)throw(a.error||b.error||c.error);res.json({vehicles:a.data,bookings:b.data,blocks:c.data});}catch(e){err(res,e)}});
app.post('/api/admin/decide',owner,async(req,res)=>{try{if(!uuid(req.body?.id)||!['approved','rejected'].includes(req.body?.status))return fail(res,400,'Invalid decision');const {error}=await db.rpc('owner_decide_booking',{p_id:req.body.id,p_status:req.body.status});if(error)return fail(res,409,error.message);res.json({ok:true});}catch(e){err(res,e)}});
app.post('/api/admin/vehicles',owner,async(req,res)=>{try{const b=req.body||{};const name=clean(b.name,100),description=clean(b.description,300),seats=Number(b.seats);if(name.length<2||!['5 Seater','7 Seater','Tempo Traveller'].includes(b.category)||!Number.isInteger(seats)||seats<1||seats>30||typeof b.ac!=='boolean')return fail(res,400,'Invalid vehicle');const {error}=await db.from('vehicles').insert({name,category:b.category,seats,ac:b.ac,description});if(error)throw error;res.json({ok:true});}catch(e){err(res,e)}});
app.patch('/api/admin/vehicles/:id',owner,async(req,res)=>{try{if(!uuid(req.params.id)||typeof req.body?.active!=='boolean')return fail(res,400,'Invalid request');const {error}=await db.from('vehicles').update({active:req.body.active}).eq('id',req.params.id);if(error)throw error;res.json({ok:true});}catch(e){err(res,e)}});
app.post('/api/admin/blocks',owner,async(req,res)=>{try{const b=req.body||{};if(!uuid(b.vehicleId)||!iso(b.start)||!iso(b.end)||b.end<b.start)return fail(res,400,'Invalid block');const {error}=await db.rpc('owner_block_vehicle',{p_vehicle:b.vehicleId,p_start:b.start,p_end:b.end,p_reason:clean(b.reason,100)});if(error)return fail(res,409,error.message);res.json({ok:true});}catch(e){err(res,e)}});
app.delete('/api/admin/blocks/:id',owner,async(req,res)=>{try{if(!uuid(req.params.id))return fail(res,400,'Invalid ID');const {error}=await db.from('vehicle_blocks').delete().eq('id',req.params.id);if(error)throw error;res.json({ok:true});}catch(e){err(res,e)}});
app.use(express.static(root,{extensions:['html']}));app.get('/health',(req,res)=>res.json({ok:true}));app.listen(PORT,()=>console.log('SHYAMORA listening on',PORT));
