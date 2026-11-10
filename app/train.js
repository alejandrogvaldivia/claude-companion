'use strict';
// ventanita para entrenar a un Clawd: su función y sus instrucciones (y si queda fijo)
const $ = (id) => document.getElementById(id);
const api = window.train;
api.get().then((d) => {
  if (!d) { window.close(); return; }
  $('title').textContent = `Entrenar a ${d.name}`;
  document.title = `Entrenar a ${d.name}`;
  $('role').value = d.title || '';
  $('text').value = d.text || '';
  $('pinned').checked = !!d.pinned;
  $('pinned').closest('label').hidden = !d.canPin;
  $('clear').hidden = !(d.title || d.text);
  $('role').focus();
});
$('save').addEventListener('click', () => api.save({ title: $('role').value.trim(), text: $('text').value.trim(), pinned: $('pinned').checked }));
$('clear').addEventListener('click', () => api.save({ title: '', text: '', pinned: $('pinned').checked }));
$('cancel').addEventListener('click', () => api.close());
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') api.close();
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) $('save').click();
});
