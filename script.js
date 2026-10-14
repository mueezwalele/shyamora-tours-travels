'use strict';
const WHATSAPP_NUMBER = '919175776421'; // India country code + business number
const form = document.getElementById('bookingForm');
const departure = document.getElementById('departure');
const returnDate = document.getElementById('returnDate');
const returnWrap = document.getElementById('returnWrap');
const error = document.getElementById('formError');
const today = new Date();
const localToday = [today.getFullYear(), String(today.getMonth()+1).padStart(2,'0'), String(today.getDate()).padStart(2,'0')].join('-');
departure.min = localToday;
returnDate.min = localToday;
function updateTripType(){
  const isRound = document.querySelector('input[name="tripType"]:checked').value === 'Round-trip';
  returnWrap.classList.toggle('hidden',!isRound);
  returnDate.required = isRound;
  if(!isRound) returnDate.value = '';
}
document.querySelectorAll('input[name="tripType"]').forEach(r=>r.addEventListener('change',updateTripType));
departure.addEventListener('change',()=>{returnDate.min = departure.value || localToday; if(returnDate.value && returnDate.value < departure.value) returnDate.value='';});
form.addEventListener('submit',e=>{
  e.preventDefault();error.textContent='';
  if(!form.reportValidity()) return;
  const tripType = document.querySelector('input[name="tripType"]:checked').value;
  if(departure.value < localToday){error.textContent='Please choose a future departure date.';return;}
  if(tripType==='Round-trip' && returnDate.value < departure.value){error.textContent='Return date must be on or after departure date.';return;}
  const lines = [
    'Hello SHYAMORA TOURS AND TRAVELS,',
    'I would like to enquire about a car trip.',
    '',
    `Trip type: ${tripType}`,
    `Pickup: ${document.getElementById('pickup').value}, Maharashtra`,
    `Destination: ${document.getElementById('destination').value.trim()}`,
    `Departure: ${departure.value}`,
    ...(tripType==='Round-trip' ? [`Return: ${returnDate.value}`] : []),
    `Vehicle: ${document.getElementById('vehicle').value}`,
    `Passengers: ${document.getElementById('passengers').value}`,
    `Travel requirement: ${document.getElementById('travelPurpose').value}`,
    `Name: ${document.getElementById('customerName').value.trim()}`,
    `Phone: ${document.getElementById('customerPhone').value.trim()}`,
    '',
    'Please share availability and a fare quote.'
  ];
  const url=`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(lines.join('\n'))}`;
  const newWindow=window.open(url,'_blank','noopener,noreferrer');
  if(!newWindow){window.location.href=url;}
});
document.querySelectorAll('.fleet-book').forEach(btn=>btn.addEventListener('click',()=>{
  document.getElementById('vehicle').value=btn.dataset.vehicle;
  document.getElementById('booking').scrollIntoView({behavior:'smooth'});
}));
document.querySelectorAll('.route-card').forEach(btn=>btn.addEventListener('click',()=>{
  document.getElementById('pickup').value=btn.dataset.from;
  document.getElementById('destination').value=btn.dataset.to;
  document.getElementById('booking').scrollIntoView({behavior:'smooth'});
}));
const menuToggle=document.getElementById('menuToggle');
const mainNav=document.getElementById('mainNav');
menuToggle.addEventListener('click',()=>{
  const open=mainNav.classList.toggle('open');
  menuToggle.setAttribute('aria-expanded',String(open));
  menuToggle.setAttribute('aria-label',open?'Close navigation':'Open navigation');
});
mainNav.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>{
  mainNav.classList.remove('open');menuToggle.setAttribute('aria-expanded','false');
}));
document.getElementById('year').textContent=new Date().getFullYear();
updateTripType();
