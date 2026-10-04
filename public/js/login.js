// Si esta pestaña ya tiene sesión, entra directo al chat
if (sessionStorage.getItem('token')) location.href = '/chat.html';

const form = document.getElementById('formLogin');
const errorEl = document.getElementById('error');

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  // ¿Presionó "Entrar" o "Crear cuenta"?
  const accion = e.submitter?.value || 'login';
  const usuario = form.usuario.value.trim();
  const password = form.password.value;

  const botones = form.querySelectorAll('button');
  botones.forEach(b => b.disabled = true);
  errorEl.textContent = '';

  try {
    const res = await fetch('/api/' + accion, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario, password })
    });
    const datos = await res.json();
    if (!res.ok) throw new Error(datos.error || 'Algo salió mal');

    sessionStorage.setItem('token', datos.token);
    sessionStorage.setItem('usuario', datos.usuario);
    location.href = '/chat.html';
  } catch (err) {
    errorEl.textContent = err.message === 'Failed to fetch'
      ? 'No hay conexión con el servidor.'
      : err.message;
    botones.forEach(b => b.disabled = false);
  }
});