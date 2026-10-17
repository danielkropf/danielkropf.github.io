'use strict';
const cards = [...document.querySelectorAll('.photo')];
const filters = [...document.querySelectorAll('[data-filter]')];
const dialog = document.querySelector('#lightbox');
const viewerImage = document.querySelector('#viewer-image');
let current = 0;
let visible = cards;
let opener;
const names = {futebol:'Futebol',basquete:'Basquete',volei:'Vôlei'};
filters.forEach(button => button.addEventListener('click', () => {
  filters.forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  const category = button.dataset.filter;
  cards.forEach(card => {card.hidden = category !== 'all' && card.dataset.category !== category;});
  visible = cards.filter(card => !card.hidden);
  document.querySelector('#gallery-status').textContent = `${visible.length} fotografias${category === 'all' ? '' : ' · ' + names[category]}`;
}));
function showPhoto(index) {
  current = (index + visible.length) % visible.length;
  const card = visible[current];
  const image = card.querySelector('img');
  viewerImage.src = image.dataset.large;
  viewerImage.alt = image.alt;
  document.querySelector('#photo-category').textContent = names[card.dataset.category].toUpperCase();
  document.querySelector('#photo-caption').textContent = card.dataset.caption;
  document.querySelector('#photo-count').textContent = `${String(current + 1).padStart(2,'0')} / ${String(visible.length).padStart(2,'0')}`;
}
cards.forEach(card => card.querySelector('button').addEventListener('click', event => {
  opener = event.currentTarget;
  showPhoto(visible.indexOf(card));
  dialog.showModal();
  document.body.classList.add('viewer-open');
}));
document.querySelector('#close-viewer').addEventListener('click',()=>dialog.close());
document.querySelector('#prev-photo').addEventListener('click',()=>showPhoto(current-1));
document.querySelector('#next-photo').addEventListener('click',()=>showPhoto(current+1));
dialog.addEventListener('close',()=>{document.body.classList.remove('viewer-open');opener?.focus({preventScroll:true});});
dialog.addEventListener('keydown',event=>{
  if(event.key==='ArrowLeft'){event.preventDefault();showPhoto(current-1);}
  if(event.key==='ArrowRight'){event.preventDefault();showPhoto(current+1);}
});
let touchX;
viewerImage.addEventListener('touchstart',event=>{touchX=event.touches.length===1?event.touches[0].clientX:undefined;},{passive:true});
viewerImage.addEventListener('touchend',event=>{
 if(touchX===undefined)return;
 const distance=event.changedTouches[0].clientX-touchX;
 if(Math.abs(distance)>65)showPhoto(current+(distance<0?1:-1));
 touchX=undefined;
},{passive:true});
document.querySelector('#year').textContent=new Date().getFullYear();
