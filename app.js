// Arranque: la sesión (sesion.js) se restaura también tras recargar con F5. Solo si no existe o
// venció se envía al login (replace evita volver con "Atrás").
const usuarioActual = Sesion.obtener();
if (!usuarioActual) {
    window.location.replace('login.html');
}

// Solo Administrador (1) y Superusuario (3) crean/editan/eliminan productos (precios y stock).
// El Cajero (2) consulta el inventario en modo lectura. La API aplica la misma regla (403).
const puedeEditarInventario = !!usuarioActual && (usuarioActual.idRol === 1 || usuarioActual.idRol === 3);

// Toda petición a la API:
// - va sin caché del navegador (tras guardar, los listados deben traer el estado actual);
// - lleva "Authorization: Bearer <token>" (la API rechaza con 401 las peticiones sin token);
// - si la API responde 401 (token vencido o inválido) se cierra la sesión y se vuelve al login.
const API_BASE = 'https://la-micho-heladeria-backend.onrender.com';
const fetchOriginal = window.fetch.bind(window);
window.fetch = async (recurso, opciones = {}) => {
    const url = typeof recurso === 'string' ? recurso : recurso.url;
    if (!url.startsWith(API_BASE)) {
        return fetchOriginal(recurso, { cache: 'no-store', ...opciones });
    }

    const cabeceras = new Headers(opciones.headers || {});
    const token = Sesion.token();
    if (token) cabeceras.set('Authorization', `Bearer ${token}`);

    const res = await fetchOriginal(recurso, { cache: 'no-store', ...opciones, headers: cabeceras });

    // El login (desbloqueo por inactividad) responde 401 ante contraseña incorrecta: eso no cierra la sesión
    if (res.status === 401 && !url.includes('/api/Usuarios/Login')) {
        Sesion.cerrar();
        alert('Tu sesión expiró o no es válida. Inicia sesión de nuevo.');
        window.location.replace('login.html');
    }
    return res;
};

// Escapa texto antes de insertarlo con innerHTML / plantillas. Nombres de productos, clientes,
// categorías, etc. los escribe cualquier usuario: sin escapar, un nombre como
// <img src=x onerror=...> ejecutaría código en el navegador de quien vea la tabla (XSS).
function escaparHTML(valor) {
    return String(valor ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// UUID v4 para la cabecera X-Idempotency-Key. crypto.randomUUID solo existe en contextos seguros
// (https o localhost); si no está, se arma con crypto.getRandomValues.
function generarUUID() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return window.crypto.randomUUID();
    }
    const b = window.crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; // versión 4
    b[8] = (b[8] & 0x3f) | 0x80; // variante RFC 4122
    const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// fetch con reintentos automáticos SOLO ante fallos de red o 502/503/504 (Render dormido o
// Supabase lento). Es seguro reintentar un POST de venta porque lleva la misma clave de
// idempotencia: si el primer envío sí se guardó, el backend devuelve esa misma venta.
async function fetchConReintentos(url, opciones, esperasMs = [1500, 3000]) {
    for (let intento = 0; ; intento++) {
        try {
            const res = await fetch(url, opciones);
            if (![502, 503, 504].includes(res.status) || intento >= esperasMs.length) {
                return res;
            }
        } catch (err) {
            if (intento >= esperasMs.length) throw err;
        }
        await new Promise(resolver => setTimeout(resolver, esperasMs[intento]));
    }
}

// Lee una respuesta fetch de forma segura: el backend .NET puede responder con JSON,
// texto plano o cuerpo vacío. Nunca lanza error por formato; devuelve { ok, texto, datos }.
async function leerRespuesta(res) {
    const texto = await res.text();
    let datos = null;
    try {
        datos = texto ? JSON.parse(texto) : null;
    } catch {
        datos = null; // No era JSON: se usa el texto tal cual
    }
    return { ok: res.ok, texto, datos };
}

// Evita envíos dobles: mientras la petición está en curso el botón queda deshabilitado (con un texto
// de "en curso") y cualquier envío adicional se ignora. Devuelve la función que lo libera, o null si
// ya había un envío en curso.
function bloquearEnvio(elemento, boton, textoEnCurso = 'Guardando...') {
    if (elemento.dataset.enviando === 'true') return null;
    elemento.dataset.enviando = 'true';
    const textoOriginal = boton ? boton.textContent : '';
    if (boton) {
        boton.disabled = true;
        boton.textContent = textoEnCurso;
    }
    return () => {
        elemento.dataset.enviando = 'false';
        if (boton) {
            boton.disabled = false;
            boton.textContent = textoOriginal;
        }
    };
}

// Texto para mostrar al usuario: el "mensaje" del backend si viene en JSON, si no el texto crudo
function mensajeDe({ texto, datos }, porDefecto = 'Error desconocido.') {
    return (datos && datos.mensaje) || texto || porDefecto;
}

document.addEventListener('DOMContentLoaded', () => {
    // Si se está redirigiendo al login, no inicializar el dashboard
    if (!usuarioActual) return;

    const navLinks = document.querySelectorAll('.nav-links a');

    // ==========================================
    // MENÚ LATERAL RESPONSIVE (cajón en pantallas < 900px)
    // ==========================================
    const btnMenu = document.getElementById('btn-menu');
    const overlayMenu = document.getElementById('sidebar-overlay');

    function abrirCerrarMenu(abrir) {
        document.body.classList.toggle('menu-abierto', abrir);
        if (btnMenu) {
            btnMenu.setAttribute('aria-expanded', String(abrir));
            btnMenu.setAttribute('aria-label', abrir ? 'Cerrar menú' : 'Abrir menú');
        }
    }

    if (btnMenu) {
        btnMenu.addEventListener('click', () => abrirCerrarMenu(!document.body.classList.contains('menu-abierto')));
    }
    if (overlayMenu) {
        overlayMenu.addEventListener('click', () => abrirCerrarMenu(false));
    }
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') abrirCerrarMenu(false);
    });
    // Al elegir una sección en el celular, el menú se cierra para mostrar el contenido
    navLinks.forEach(link => link.addEventListener('click', () => abrirCerrarMenu(false)));
    // Si la pantalla vuelve a ser ancha, se quita el estado de cajón abierto
    window.matchMedia('(min-width: 901px)').addEventListener('change', (e) => {
        if (e.matches) abrirCerrarMenu(false);
    });
    const sectionTitle = document.getElementById('section-title');
    const contentBody = document.querySelector('.content-body');

    // --- CONFIGURACIÓN DEL BOTÓN DE CERRAR SESIÓN ---
    const btnCerrarSesion = document.getElementById('btn-cerrar-sesion');
    if (btnCerrarSesion) {
        btnCerrarSesion.addEventListener('click', () => {
            if (confirm('¿Estás seguro de que deseas cerrar sesión?')) {
                Sesion.cerrar();
                window.location.replace('login.html');
            }
        });
    }

    // Identificar el rol en texto para la consola
    const nombreRol = usuarioActual.idRol === 3 ? 'Superusuario' : (usuarioActual.idRol === 2 ? 'Cajero' : 'Administrador');
    console.log(`Usuario conectado con éxito: ${usuarioActual.nombreCompleto} (Rol: ${nombreRol})`);

    // Etiqueta superior derecha: nombre y rol de quien inició sesión (antes era un texto fijo).
    // textContent: el nombre viene de la base de datos y nunca se interpreta como HTML.
    const etiquetaUsuario = document.getElementById('usuario-sesion');
    if (etiquetaUsuario) {
        const nombre = (usuarioActual.nombreCompleto || '').trim();
        etiquetaUsuario.textContent = nombre ? `${nombre} · ${nombreRol}` : `La Micho ${nombreRol}`;
        etiquetaUsuario.title = `${nombre || 'Usuario'} (${nombreRol}) · La Micho Heladería`;
    }

    // --- CONFIGURACIÓN DE INACTIVIDAD (5 MINUTOS) ---
    let temporizadorInactividad;
    const TIEMPO_INACTIVIDAD_MS = 5 * 60 * 1000; // 5 minutos

    function mostrarModalBloqueo() {
        // Evitar duplicar modales si ya está abierto
        if (document.getElementById('modal-bloqueo-inactividad')) return;
        // Se recuerda el bloqueo para que recargar con F5 no lo salte
        Sesion.marcarBloqueada(true);

        const modalHTML = `
            <div id="modal-bloqueo-inactividad" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(62, 39, 35, 0.85); display: flex; justify-content: center; align-items: center; z-index: 9999;">
                <div style="background: white; padding: 30px; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.4); width: 100%; max-width: 400px; text-align: center;">
                    <h3 style="color: var(--color-texto); margin-bottom: 10px;">Sesión Bloqueada por Inactividad</h3>
                    <p style="color: var(--color-texto-suave); font-size: 0.9rem; margin-bottom: 20px;">
                        Han pasado 5 minutos sin actividad. Por seguridad, ingresa tu contraseña para continuar, <b>${escaparHTML(usuarioActual.nombreCompleto)}</b>.
                    </p>
                    <form id="form-desbloqueo" style="display: flex; flex-direction: column; gap: 12px;">
                        
                        <!-- Contenedor del Input de Contraseña con el Icono Ojo -->
                        <div style="position: relative; width: 100%;">
                            <input type="password" id="input-pass-bloqueo" placeholder="Contraseña actual" required style="padding: 10px; padding-right: 40px; border: 1px solid var(--color-borde-fuerte); border-radius: 4px; box-sizing: border-box; width: 100%;">
                            <span id="btn-toggle-bloqueo" style="position: absolute; right: 12px; top: 50%; transform: translateY(-50%); cursor: pointer; font-size: 1.1rem; user-select: none;">👁️</span>
                        </div>

                        <button type="submit" id="btn-submit-desbloquear" style="padding: 10px; background-color: var(--color-primario-boton); color: var(--color-texto-invertido); border: none; border-radius: 4px; font-weight: bold; cursor: pointer;">Desbloquear</button>
                        <button type="button" id="btn-forzar-salir" style="padding: 8px; background: none; border: none; color: var(--color-peligro); cursor: pointer; font-size: 0.85rem;">Cerrar sesión actual</button>
                    </form>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHTML);

        // --- Lógica del Botón Ojo (Mostrar/Ocultar Contraseña) ---
        const inputPassBloqueo = document.getElementById('input-pass-bloqueo');
        const btnToggleBloqueo = document.getElementById('btn-toggle-bloqueo');

        btnToggleBloqueo.addEventListener('click', () => {
            if (inputPassBloqueo.type === 'password') {
                inputPassBloqueo.type = 'text';
                btnToggleBloqueo.textContent = '🙈';
            } else {
                inputPassBloqueo.type = 'password';
                btnToggleBloqueo.textContent = '👁️';
            }
        });

        // --- Lógica de Desbloqueo ---
        document.getElementById('form-desbloqueo').addEventListener('submit', (e) => {
            e.preventDefault();
            const passwordIngresada = inputPassBloqueo.value;
            const btnSubmit = document.getElementById('btn-submit-desbloquear');

            btnSubmit.textContent = 'Verificando... (Servidor conectando)';
            btnSubmit.disabled = true;
            btnSubmit.style.opacity = '0.7';

            fetch('https://la-micho-heladeria-backend.onrender.com/api/Usuarios/Login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: usuarioActual.email, contrasena: passwordIngresada })
            })
                .then(async res => {
                    if (res.ok) {
                        // El login devuelve un token nuevo (8 h más): se renueva el de la sesión
                        const { datos } = await leerRespuesta(res);
                        if (datos && datos.token) Sesion.guardarToken(datos.token, datos.expiraEn);
                        Sesion.marcarBloqueada(false);
                        document.getElementById('modal-bloqueo-inactividad').remove();
                        reiniciarTemporizadorInactividad();
                    } else {
                        alert('Contraseña incorrecta. Inténtalo de nuevo.');
                        btnSubmit.textContent = 'Desbloquear';
                        btnSubmit.disabled = false;
                        btnSubmit.style.opacity = '1';
                    }
                })
                .catch(() => {
                    alert('Error de conexión con el servidor al verificar credenciales.');
                    btnSubmit.textContent = 'Desbloquear';
                    btnSubmit.disabled = false;
                    btnSubmit.style.opacity = '1';
                });
        });

        document.getElementById('btn-forzar-salir').addEventListener('click', () => {
            Sesion.cerrar();
            window.location.replace('login.html');
        });
    }

    function reiniciarTemporizadorInactividad() {
        // Mientras la sesión está bloqueada la actividad no cuenta
        if (document.getElementById('modal-bloqueo-inactividad')) return;
        Sesion.renovar(); // la actividad extiende el vencimiento de la sesión
        clearTimeout(temporizadorInactividad);
        temporizadorInactividad = setTimeout(mostrarModalBloqueo, TIEMPO_INACTIVIDAD_MS);
    }

    ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach(evento => {
        window.addEventListener(evento, reiniciarTemporizadorInactividad, true);
    });

    // Si se recargó con la sesión bloqueada, se vuelve a pedir la contraseña
    if (Sesion.estaBloqueada()) {
        mostrarModalBloqueo();
    } else {
        reiniciarTemporizadorInactividad();
    }

    // Cerrar sesión en otra pestaña también la cierra aquí
    window.addEventListener('storage', (e) => {
        if ((e.key === Sesion.CLAVE_USUARIO || e.key === null) && !Sesion.obtener()) {
            window.location.replace('login.html');
        }
    });

    if (usuarioActual.idRol === 2) {
        navLinks.forEach(link => {
            const seccion = link.getAttribute('data-section');
            if (seccion === 'dashboard' || seccion === 'clientes' || seccion === 'producto-mas-vendido') {
                link.parentElement.style.display = 'none';
            }
        });
    }

    // Cada vez que se dibuja una sección se incrementa este contador. Los enlaces de eventos se hacen en
    // un setTimeout; si mientras tanto se dibujó otra sección (p. ej. doble clic en el menú), el
    // temporizador viejo no hace nada. Antes ambos temporizadores enlazaban el MISMO formulario y cada
    // "Guardar" enviaba dos peticiones: la primera creaba el registro y la segunda respondía "ya existe".
    let contadorRender = 0;

    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const section = link.getAttribute('data-section');
            const miRender = ++contadorRender;
            Sesion.guardarSeccion(section); // al recargar se vuelve a esta sección

            if (usuarioActual.idRol === 2 && (section === 'dashboard' || section === 'clientes' || section === 'producto-mas-vendido')) {
                alert('Acceso denegado. Este módulo está restringido para tu rol.');
                return;
            }

            navLinks.forEach(item => item.classList.remove('active'));
            link.classList.add('active');

            // Cambiar el título superior y el contenido según la opción
            switch (section) {
                case 'Inicio':
                    sectionTitle.textContent = ' Inicio ';
                    let contenidoDashboard = `
                    <div class="card" style="margin-bottom: 20px;">
                    <h3>Bienvenido ${escaparHTML(usuarioActual.nombreCompleto || 'Usuario')}</h3>
                    <p>Selecciona una opcion del menu para iniciar.</p>
                </div>
            `;
                    // Si el usuario es Superusuario (3) o Administrador (1), le mostramos el módulo para crear usuarios
                    if (usuarioActual.idRol === 3 || usuarioActual.idRol === 1) {
                        const opcionesRolHTML = usuarioActual.idRol === 3
                            ? `<option value="1">Administrador / Dueño del local</option>
                   <option value="2">Cajero</option>`
                            : `<option value="2">Cajero</option>`;

                        contenidoDashboard += `
                <div class="card" style="max-width: 600px; margin: 0 auto;">
                    <h3 style="color: var(--color-texto); margin-bottom: 10px;">Crear Nuevo Usuario</h3>
                    <p style="color: var(--color-texto-suave); font-size: 0.9rem; margin-bottom: 15px; line-height: 1.5;">
                        ${usuarioActual.idRol === 3 ? 'Como Superusuario, puedes registrar cuentas para administradores o cajeros.' : 'Como Administrador, puedes registrar cuentas para los cajeros.'}
                    </p>
                    <form id="form-crear-usuario-admin" style="display: flex; flex-direction: column; gap: 12px;">
                        <input type="text" id="nuevo-nombre" placeholder="Nombre completo" required style="padding: 10px 12px; background: var(--color-fondo); border: 1px solid var(--color-borde); border-radius: 6px; color: var(--color-texto); outline: none;">
                        <input type="email" id="nuevo-correo" placeholder="Correo electrónico" required style="padding: 10px 12px; background: var(--color-fondo); border: 1px solid var(--color-borde); border-radius: 6px; color: var(--color-texto); outline: none;">
                        <input type="password" id="nuevo-contrasena" placeholder="Contraseña (Mín. 8 caracteres, 1 may., 1 núm., 1 especial)" required style="padding: 10px 12px; background: var(--color-fondo); border: 1px solid var(--color-borde); border-radius: 6px; color: var(--color-texto); outline: none;">
                        <label for="nuevo-rol" style="font-weight: 500; color: var(--color-texto-suave); font-size: 0.9rem;">Asignar Rol:</label>
                        <select id="nuevo-rol" required style="padding: 10px 12px; background: var(--color-fondo); border: 1px solid var(--color-borde); border-radius: 6px; color: var(--color-texto); outline: none;">
                            <option value="" style="background: var(--color-superficie); color: var(--color-texto);">Seleccione un rol...</option>
                            ${opcionesRolHTML}
                        </select>
                        <button type="submit" style="padding: 11px 15px; background: var(--color-primario-boton); color: var(--color-texto-invertido); border: none; border-radius: 6px; font-weight: 600; cursor: pointer; margin-top: 5px; box-shadow: var(--sombra-boton);">Crear Usuario</button>
                    </form>
                </div>
                `;
                    }
                    contentBody.innerHTML = contenidoDashboard;

                    setTimeout(() => {

                        if (miRender !== contadorRender) return; // Se dibujó otra sección: no enlazar dos veces
                        const formCrearUsuario = document.getElementById('form-crear-usuario-admin');
                        if (formCrearUsuario) {
                            const btnCrearUsuario = formCrearUsuario.querySelector('button[type="submit"]');
                            // Bandera para evitar doble envío mientras la petición está en curso
                            let isSubmitting = false;

                            formCrearUsuario.addEventListener('submit', (e) => {
                                e.preventDefault();
                                if (isSubmitting) return;

                                const nombre = document.getElementById('nuevo-nombre').value.trim();
                                const email = document.getElementById('nuevo-correo').value.trim();
                                const contrasena = document.getElementById('nuevo-contrasena').value;
                                const idRol = parseInt(document.getElementById('nuevo-rol').value);

                                const validarPatronContrasena = (pass) => {
                                    const minLength = pass.length >= 8;
                                    const hasUpperCase = /[A-Z]/.test(pass);
                                    const hasNumber = /[0-9]/.test(pass);
                                    const hasSpecialChar = /[^a-zA-Z0-9]/.test(pass);
                                    return minLength && hasUpperCase && hasNumber && hasSpecialChar;
                                };

                                if (!validarPatronContrasena(contrasena)) {
                                    alert('La contraseña debe tener al menos 8 caracteres, incluir una letra mayúscula, un número y un carácter especial.');
                                    return;
                                }

                                const nuevoUsuarioData = {
                                    nombreCompleto: nombre,
                                    email: email,
                                    contrasena: contrasena,
                                    idRol: idRol
                                };

                                // Depuración: JSON que se envía al backend (contraseña oculta)
                                console.log('Registro de usuario - payload:', { ...nuevoUsuarioData, contrasena: '********' });

                                isSubmitting = true;
                                btnCrearUsuario.textContent = 'Creando usuario...';
                                btnCrearUsuario.disabled = true;
                                btnCrearUsuario.style.opacity = '0.7';

                                fetch('https://la-micho-heladeria-backend.onrender.com/api/Usuarios/Registro', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify(nuevoUsuarioData)
                                })
                                    .then(leerRespuesta)
                                    .then(({ ok, texto }) => {
                                        if (ok) {
                                            // Limpiar el formulario antes del aviso para no reenviar el mismo correo
                                            formCrearUsuario.reset();
                                            alert('¡Creado con éxito!');
                                        } else {
                                            alert('Error al crear usuario: ' + texto);
                                        }
                                    })
                                    .catch(err => {
                                        console.error('Error de red:', err);
                                        alert('Error de conexión con el servidor al crear el usuario.');
                                    })
                                    .finally(() => {
                                        isSubmitting = false;
                                        btnCrearUsuario.textContent = 'Crear Usuario';
                                        btnCrearUsuario.disabled = false;
                                        btnCrearUsuario.style.opacity = '1';
                                    });
                            });
                        }
                    }, 100);
                    break;

                case 'inventario':
                    sectionTitle.textContent = 'Inventario de productos';
                    contentBody.innerHTML = `
        <!-- FORMULARIO PARA AGREGAR NUEVO PRODUCTO (oculto para el Cajero) -->
        <div class="card" style="margin-bottom: 20px;${puedeEditarInventario ? '' : ' display: none;'}">
            <h3 style="color: var(--color-texto); margin-bottom: 10px;">Registrar Nuevo Producto</h3>
            <form id="form-crear-producto-inventario" style="display: flex; gap: 10px; margin-top: 15px; flex-wrap: wrap;">
                <input type="text" id="nuevo-prod-nombre" placeholder="Nombre del producto" required style="padding: 10px 12px; flex: 1; min-width: 150px; background: var(--color-fondo); border: 1px solid var(--color-borde); border-radius: 6px; color: var(--color-texto); outline: none;">
                <input type="number" id="nuevo-prod-precio" placeholder="Precio" step="0.01" required style="padding: 10px 12px; flex: 1; min-width: 120px; background: var(--color-fondo); border: 1px solid var(--color-borde); border-radius: 6px; color: var(--color-texto); outline: none;">
                <input type="number" id="nuevo-prod-stock" placeholder="Stock / Cantidad inicial" min="0" required style="padding: 10px 12px; flex: 1; min-width: 120px; background: var(--color-fondo); border: 1px solid var(--color-borde); border-radius: 6px; color: var(--color-texto); outline: none;">
                
                <!-- Input de texto con datalist para escribir o autocompletar la categoría -->
                <div style="flex: 1; min-width: 150px; position: relative;">
                    <input type="text" id="nuevo-prod-categoria" placeholder="Escribe la categoría..." list="lista-categorias-sugeridas" required style="width: 100%; padding: 10px 12px; background: var(--color-fondo); border: 1px solid var(--color-borde); border-radius: 6px; color: var(--color-texto); outline: none; box-sizing: border-box;">
                    <datalist id="lista-categorias-sugeridas"></datalist>
                </div>

                <input type="text" id="nuevo-prod-descripcion" placeholder="Descripción (Opcional)" style="padding: 10px 12px; flex: 1; min-width: 200px; background: var(--color-fondo); border: 1px solid var(--color-borde); border-radius: 6px; color: var(--color-texto); outline: none;">
                <button type="submit" style="padding: 10px 18px; background: var(--color-primario-boton); color: var(--color-texto-invertido); border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">Guardar Producto</button>
            </form>
        </div>

        <!-- FORMULARIO DESPLEGABLE PARA EDITAR PRODUCTO -->
        <div class="card" id="card-formulario-producto" style="margin-bottom: 20px; display: none; background-color: var(--color-fondo); border: 1px solid var(--color-secundario);">
            <h3 id="titulo-form-productos" style="color: var(--color-texto); margin-bottom: 10px;">Editar Producto</h3>
            <form id="form-editar-producto" style="display: flex; gap: 10px; margin-top: 15px; flex-wrap: wrap;">  
                <input type="hidden" id="edit-id">
                <input type="hidden" id="edit-stock-original">
                <input type="text" id="edit-nombre" placeholder="Nombre del producto" required style="padding: 10px 12px; flex: 1; min-width: 150px; background: var(--color-superficie); border: 1px solid var(--color-borde); border-radius: 6px; color: var(--color-texto); outline: none;">
                <input type="number" id="edit-precio" placeholder="Precio" step="0.01" required style="padding: 10px 12px; flex: 1; min-width: 120px; background: var(--color-superficie); border: 1px solid var(--color-borde); border-radius: 6px; color: var(--color-texto); outline: none;">
                <input type="number" id="edit-stock" placeholder="Stock a agregar" required style="padding: 10px 12px; flex: 1; min-width: 100px; background: var(--color-superficie); border: 1px solid var(--color-borde); border-radius: 6px; color: var(--color-texto); outline: none;">
                
                <!-- Input de texto con datalist para edición -->
                <div style="flex: 1; min-width: 150px; position: relative;">
                    <input type="text" id="edit-categoria" placeholder="Escribe la categoría..." list="lista-categorias-sugeridas" required style="width: 100%; padding: 10px 12px; background: var(--color-superficie); border: 1px solid var(--color-borde); border-radius: 6px; color: var(--color-texto); outline: none; box-sizing: border-box;">
                </div>

                <input type="text" id="edit-descripcion" placeholder="Descripción del producto" style="padding: 10px 12px; flex: 1; min-width: 200px; background: var(--color-superficie); border: 1px solid var(--color-borde); border-radius: 6px; color: var(--color-texto); outline: none;">
                <button type="submit" style="padding: 10px 18px; background: var(--color-primario-boton); color: var(--color-texto-invertido); border: none; border-radius: 6px; cursor: pointer; font-weight: 600; box-shadow: var(--sombra-boton);">Actualizar</button>
                <button type="button" id="btn-cancelar-edit" style="padding: 10px 18px; background-color: var(--color-superficie); color: var(--color-texto); border: 1px solid var(--color-borde-fuerte); border-radius: 6px; cursor: pointer; font-weight: 600;">Cancelar</button>
            </form>
        </div>

        <!-- TABLA DE PRODUCTOS EN STOCK -->
        <div class="card">
            <h3 style="color: var(--color-texto); margin-bottom: 10px;">Productos en stock</h3>
            ${puedeEditarInventario ? '' : '<p style="margin: -4px 0 10px; color: var(--color-texto-suave); font-size: 0.9rem;">Modo consulta: solo un Administrador puede cambiar precios y stock.</p>'}
            <div id="contenedor-tabla">
                <p style="padding: 15px; color: var(--color-texto-suave); text-align: center;">Cargando productos...</p>
            </div>
        </div>
    `;

                    let categoriasGlobal = [];
                    function cargarCategoriasDatalist() {
                        return fetch('https://la-micho-heladeria-backend.onrender.com/api/Categorias')
                            .then(res => res.json())
                            .then(categorias => {
                                categoriasGlobal = categorias;
                                const datalist = document.getElementById('lista-categorias-sugeridas');
                                if (datalist) {
                                    datalist.innerHTML = '';
                                    categorias.forEach(cat => {
                                        const nombreCat = cat.nombreCategoria || cat.nombre || '';
                                        if (nombreCat) {
                                            datalist.innerHTML += `<option value="${escaparHTML(nombreCat)}">`;
                                        }
                                    });
                                }
                            })
                            .catch(err => console.error('Error al cargar categorías:', err));
                    }

                    function cargarInventario() {
                        return fetch('https://la-micho-heladeria-backend.onrender.com/api/Productos')
                            .then(response => response.json())
                            .then(productos => {
                                const contenedor = document.getElementById('contenedor-tabla');

                                if (productos.length === 0) {
                                    contenedor.innerHTML = '<p style="padding: 15px; text-align: center; color: var(--color-texto-suave);">No hay productos registrados.</p>';
                                    return;
                                }

                                let tablaHTML = `
                    <div class="tabla-responsive">
                        <table style="width:100%; border-collapse: collapse; margin-top:5px; text-align: left; color: var(--color-texto);">
                            <thead>
                                <tr style="background-color: var(--color-secundario); color: var(--color-texto); border-bottom: 2px solid var(--color-primario);">
                                    <th style="padding: 12px;">ID</th>
                                    <th style="padding: 12px;">Nombre</th>
                                    <th style="padding: 12px;">Precio</th>
                                    <th style="padding: 12px;">Stock</th>
                                    <th style="padding: 12px;">Categoría</th>
                                    ${puedeEditarInventario ? '<th style="padding: 12px; text-align: center;">Acciones</th>' : ''}
                                </tr>
                            </thead>
                            <tbody>
                `;

                                productos.forEach(prod => {
                                    const estiloStock = prod.stock <= 10 ? 'color: var(--color-peligro); font-weight: bold;' : 'color: var(--color-texto);';
                                    const nombreCategoria = prod.idCategoriaNavigation ? (prod.idCategoriaNavigation.nombreCategoria || prod.idCategoriaNavigation.nombre) : 'General';

                                    tablaHTML += `
                        <tr style="border-bottom: 1px solid var(--color-borde); transition: background 0.2s;">
                            <td style="padding: 12px; color: var(--color-texto-suave);">${escaparHTML(prod.id)}</td>
                            <td style="padding: 12px; font-weight: 500;">${escaparHTML(prod.nombre)}</td>
                            <td style="padding: 12px; color: var(--color-exito);">$${escaparHTML(prod.precio)}</td>
                            <td style="padding: 12px; ${estiloStock}">${escaparHTML(prod.stock)}</td>
                            <td style="padding: 12px; color: var(--color-texto-suave);">${escaparHTML(nombreCategoria)}</td>
                            ${puedeEditarInventario ? `<td style="padding: 12px; text-align: center;">
                                <div style="display: flex; gap: 6px; justify-content: center;">
                                    <button class="btn-editar" data-id="${escaparHTML(prod.id)}" data-nombre="${escaparHTML(prod.nombre)}" data-precio="${escaparHTML(prod.precio)}" data-stock="${escaparHTML(prod.stock)}" data-catanombre="${escaparHTML(nombreCategoria !== 'General' ? nombreCategoria : '')}" data-descripcion="${escaparHTML(prod.descripcion || '')}" style="padding: 6px 12px; background-color: var(--color-secundario); color: var(--color-texto); border: none; border-radius: 6px; cursor: pointer; font-weight: 500;">Editar</button>
                                    <button class="btn-eliminar-producto" data-id="${prod.id}" style="padding: 6px 12px; background-color: var(--color-peligro); color: var(--color-texto-invertido); border: none; border-radius: 6px; cursor: pointer; font-weight: 500;">Eliminar</button>
                                </div>
                            </td>` : ''}
                        </tr>
                    `;
                                });

                                tablaHTML += `</tbody></table></div>`;
                                contenedor.innerHTML = tablaHTML;

                                // Evento para abrir el formulario de edición
                                document.querySelectorAll('.btn-editar').forEach(btn => {
                                    btn.addEventListener('click', (e) => {
                                        const id = e.target.getAttribute('data-id');
                                        const nombre = e.target.getAttribute('data-nombre');
                                        const precio = e.target.getAttribute('data-precio');
                                        const stockactual = e.target.getAttribute('data-stock');
                                        const catNombre = e.target.getAttribute('data-catanombre');
                                        const descripcion = e.target.getAttribute('data-descripcion');

                                        document.getElementById('card-formulario-producto').style.display = 'block';
                                        document.getElementById('edit-id').value = id;
                                        document.getElementById('edit-stock-original').value = stockactual;
                                        document.getElementById('edit-nombre').value = nombre;
                                        document.getElementById('edit-precio').value = precio;
                                        document.getElementById('edit-stock').value = '';
                                        document.getElementById('edit-categoria').value = catNombre;
                                        document.getElementById('edit-descripcion').value = descripcion;

                                        window.scrollTo({ top: 0, behavior: 'smooth' });
                                    });
                                });

                                // Evento para Eliminar producto de la base de datos
                                document.querySelectorAll('.btn-eliminar-producto').forEach(btn => {
                                    btn.addEventListener('click', (e) => {
                                        const idProducto = e.target.getAttribute('data-id');

                                        if (confirm('¿Estás seguro de que deseas eliminar este producto del inventario?')) {
                                            fetch(`https://la-micho-heladeria-backend.onrender.com/api/Productos/${idProducto}`, {
                                                method: 'DELETE'
                                            })
                                                .then(response => {
                                                    if (response.ok) {
                                                        cargarInventario().then(() => alert('¡Producto eliminado con éxito!'));
                                                    } else {
                                                        alert('No se pudo eliminar el producto (puede estar asociado a ventas registradas).');
                                                    }
                                                })
                                                .catch(err => console.error('Error en DELETE Producto:', err));
                                        }
                                    });
                                });
                            })
                            .catch(error => {
                                console.error('Error al cargar los productos:', error);
                                document.getElementById('contenedor-tabla').innerHTML = '<p style="padding: 15px; color: var(--color-peligro); text-align: center;">Error al cargar los productos.</p>';
                            });
                    }

                    cargarCategoriasDatalist();
                    cargarInventario();

                    setTimeout(() => {

                        if (miRender !== contadorRender) return; // Se dibujó otra sección: no enlazar dos veces
                        // Función auxiliar para obtener el ID de la categoría por texto (o crearla automáticamente si no existe)
                        async function obtenerOidCrearCategoria(nombreCatTexto) {
                            if (!nombreCatTexto) return null;
                            const catEncontrada = categoriasGlobal.find(c => {
                                const n = c.nombreCategoria || c.nombre || '';
                                return n.toLowerCase() === nombreCatTexto.toLowerCase();
                            });

                            if (catEncontrada) {
                                return catEncontrada.id;
                            } else {
                                try {
                                    const response = await fetch('https://la-micho-heladeria-backend.onrender.com/api/Categorias', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ nombreCategoria: nombreCatTexto })
                                    });
                                    const { ok, texto, datos } = await leerRespuesta(response);
                                    if (ok && datos && datos.id) {
                                        categoriasGlobal.push(datos);
                                        return datos.id;
                                    }
                                    if (!ok) {
                                        console.warn('POST Categoría no exitoso, se busca en la lista actual:', texto);
                                    }
                                    // Sin la categoría en la respuesta (o ya existía): se recarga la lista y se busca por nombre
                                    const lista = await leerRespuesta(await fetch('https://la-micho-heladeria-backend.onrender.com/api/Categorias'));
                                    if (Array.isArray(lista.datos)) {
                                        categoriasGlobal = lista.datos;
                                        const creada = categoriasGlobal.find(c => (c.nombreCategoria || c.nombre || '').toLowerCase() === nombreCatTexto.toLowerCase());
                                        if (creada) return creada.id;
                                    }
                                } catch (e) {
                                    console.error('Error al crear categoría automáticamente:', e);
                                }
                            }
                            return null;
                        }

                        // Lógica para Crear Nuevo Producto
                        const formCrearProd = document.getElementById('form-crear-producto-inventario');
                        if (formCrearProd) {
                            formCrearProd.addEventListener('submit', async (e) => {
                                e.preventDefault();
                                // Bloqueo inmediato (antes de crear la categoría, que también es asíncrona)
                                const liberar = bloquearEnvio(formCrearProd, formCrearProd.querySelector('button[type="submit"]'));
                                if (!liberar) return;

                                const textoCat = document.getElementById('nuevo-prod-categoria').value.trim();
                                const idCat = await obtenerOidCrearCategoria(textoCat);
                                if (!idCat) {
                                    liberar();
                                    alert('No se pudo obtener ni crear la categoría "' + textoCat + '". El producto no se registró.');
                                    return;
                                }

                                const nuevoProductoData = {
                                    nombre: document.getElementById('nuevo-prod-nombre').value.trim(),
                                    precio: parseFloat(document.getElementById('nuevo-prod-precio').value),
                                    stock: parseInt(document.getElementById('nuevo-prod-stock').value),
                                    idCategoria: idCat,
                                    descripcion: document.getElementById('nuevo-prod-descripcion').value.trim(),
                                    activo: true
                                };

                                fetch('https://la-micho-heladeria-backend.onrender.com/api/Productos', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify(nuevoProductoData)
                                })
                                    .then(leerRespuesta)
                                    .then(respuesta => {
                                        const { ok, datos } = respuesta;
                                        if (ok) {
                                            formCrearProd.reset();
                                            // yaExistia: era un envío repetido del mismo producto; ya está guardado
                                            const aviso = datos && datos.yaExistia ? datos.mensaje : '¡Creado con éxito!';
                                            Promise.all([cargarCategoriasDatalist(), cargarInventario()])
                                                .then(() => alert(aviso));
                                        } else {
                                            alert('Error al crear el producto: ' + mensajeDe(respuesta));
                                        }
                                    })
                                    .catch(err => {
                                        console.error('Error en POST Producto:', err);
                                        alert('No se pudo contactar al servidor. Revise el inventario antes de reintentar.');
                                    })
                                    .finally(liberar);
                            });
                        }

                        // Lógica para Editar / Actualizar Producto
                        const formEditar = document.getElementById('form-editar-producto');
                        const btnCancelar = document.getElementById('btn-cancelar-edit');

                        if (btnCancelar) {
                            btnCancelar.addEventListener('click', () => {
                                document.getElementById('card-formulario-producto').style.display = 'none';
                                formEditar.reset();
                            });
                        }

                        if (formEditar) {
                            formEditar.addEventListener('submit', async (e) => {
                                e.preventDefault();
                                const liberar = bloquearEnvio(formEditar, formEditar.querySelector('button[type="submit"]'));
                                if (!liberar) return;
                                const id = document.getElementById('edit-id').value;
                                const stockOriginal = parseInt(document.getElementById('edit-stock-original').value) || 0;
                                const cantidadIngresada = parseInt(document.getElementById('edit-stock').value) || 0;
                                const stockFinal = stockOriginal + cantidadIngresada;

                                const textoCat = document.getElementById('edit-categoria').value.trim();
                                const idCat = await obtenerOidCrearCategoria(textoCat);
                                if (!idCat) {
                                    liberar();
                                    alert('No se pudo obtener ni crear la categoría "' + textoCat + '". El producto no se actualizó.');
                                    return;
                                }

                                const productoActualizado = {
                                    id: parseInt(id),
                                    nombre: document.getElementById('edit-nombre').value,
                                    precio: parseFloat(document.getElementById('edit-precio').value),
                                    stock: stockFinal,
                                    idCategoria: idCat,
                                    descripcion: document.getElementById('edit-descripcion').value,
                                    activo: true
                                };

                                fetch(`https://la-micho-heladeria-backend.onrender.com/api/Productos/${id}`, {
                                    method: 'PUT',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify(productoActualizado)
                                })
                                    .then(leerRespuesta)
                                    .then(({ ok, texto }) => {
                                        if (ok) {
                                            document.getElementById('card-formulario-producto').style.display = 'none';
                                            formEditar.reset();
                                            Promise.all([cargarCategoriasDatalist(), cargarInventario()])
                                                .then(() => alert(`Producto actualizado con éxito (Anterior: ${stockOriginal} + Agregados: ${cantidadIngresada} = Total: ${stockFinal})`));
                                        } else {
                                            alert('Error al actualizar producto: ' + texto);
                                        }
                                    })
                                    .catch(err => console.error('Error en PUT Producto:', err))
                                    .finally(liberar);
                            });
                        }
                    }, 100);
                    break;

                case 'clientes':
                    sectionTitle.textContent = 'Gestión de Clientes';
                    contentBody.innerHTML = `
        <!-- FORMULARIO DESPLEGABLE (ACORDEÓN) PARA EDITAR CLIENTE -->
        <div class="card" id="card-formulario-cliente" style="margin-bottom: 20px; display: none; background-color: var(--color-fondo); border: 1px solid var(--color-secundario);">
            <h3 id="titulo-form-clientes" style="color: var(--color-texto); margin-bottom: 10px;">Editar Cliente</h3>
            <form id="form-editar-cliente" style="display: flex; gap: 10px; margin-top: 15px; flex-wrap: wrap;">  
                <input type="hidden" id="edit-cliente-id">
                <input type="text" id="edit-cliente-nombre" placeholder="Nombre completo" required style="padding: 10px 12px; flex: 1; min-width: 150px; background: var(--color-superficie); border: 1px solid var(--color-borde); border-radius: 6px; color: var(--color-texto); outline: none;">
                <input type="text" id="edit-cliente-cedula" placeholder="Cédula" required style="padding: 10px 12px; flex: 1; min-width: 130px; background: var(--color-superficie); border: 1px solid var(--color-borde); border-radius: 6px; color: var(--color-texto); outline: none;">   
                <input type="text" id="edit-cliente-telefono" placeholder="Número de teléfono" required style="padding: 10px 12px; flex: 1; min-width: 130px; background: var(--color-superficie); border: 1px solid var(--color-borde); border-radius: 6px; color: var(--color-texto); outline: none;">
                <input type="email" id="edit-cliente-email" placeholder="Correo electrónico" style="padding: 10px 12px; flex: 1; min-width: 180px; background: var(--color-superficie); border: 1px solid var(--color-borde); border-radius: 6px; color: var(--color-texto); outline: none;">
                <input type="text" id="edit-cliente-direccion" placeholder="Dirección" required style="padding: 10px 12px; flex: 1; min-width: 150px; background: var(--color-superficie); border: 1px solid var(--color-borde); border-radius: 6px; color: var(--color-texto); outline: none;">
                <button type="submit" style="padding: 10px 18px; background: var(--color-primario-boton); color: var(--color-texto-invertido); border: none; border-radius: 6px; cursor: pointer; font-weight: 600; box-shadow: var(--sombra-boton);">Actualizar</button>
                <button type="button" id="btn-cancelar-edit-cliente" style="padding: 10px 18px; background-color: var(--color-superficie); color: var(--color-texto); border: 1px solid var(--color-borde-fuerte); border-radius: 6px; cursor: pointer; font-weight: 600;">Cancelar</button>
            </form>
        </div>

        <!-- FORMULARIO PARA REGISTRAR NUEVO CLIENTE -->
        <div class="card" style="margin-bottom: 20px;">
            <h3 style="color: var(--color-texto); margin-bottom: 10px;">Registrar nuevo Cliente</h3>
            <form id="form-cliente" style="display: flex; gap: 10px; margin-top: 15px; flex-wrap: wrap;">
                <input type="text" id="nombre-cliente" placeholder="Nombre completo" required style="padding: 10px 12px; flex: 1; min-width: 150px; background: var(--color-fondo); border: 1px solid var(--color-borde); border-radius: 6px; color: var(--color-texto); outline: none;">
                <input type="text" id="cedula-cliente" placeholder="Cédula" required style="padding: 10px 12px; flex: 1; min-width: 150px; background: var(--color-fondo); border: 1px solid var(--color-borde); border-radius: 6px; color: var(--color-texto); outline: none;">   
                <input type="text" id="telefono-cliente" placeholder="Número de teléfono" required style="padding: 10px 12px; flex: 1; min-width: 150px; background: var(--color-fondo); border: 1px solid var(--color-borde); border-radius: 6px; color: var(--color-texto); outline: none;">
                <input type="email" id="email-cliente" placeholder="Correo electrónico" style="padding: 10px 12px; flex: 1; min-width: 200px; background: var(--color-fondo); border: 1px solid var(--color-borde); border-radius: 6px; color: var(--color-texto); outline: none;">
                <input type="text" id="direccion-cliente" placeholder="Dirección" required style="padding: 10px 12px; flex: 1; min-width: 150px; background: var(--color-fondo); border: 1px solid var(--color-borde); border-radius: 6px; color: var(--color-texto); outline: none;">
                <button type="submit" style="padding: 10px 18px; background: var(--color-primario-boton); color: var(--color-texto-invertido); border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">Guardar cliente</button>
            </form>
        </div>

        <!-- TABLA DE CLIENTES Y FILTRO -->
        <div class="card">
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 15px;">
                <h3 style="margin: 0; color: var(--color-texto);">Clientes Registrados</h3>
                <input type="text" id="input-buscar-cliente-tabla" placeholder="Buscar cliente por nombre o cédula..." style="padding: 10px 12px; width: 280px; background: var(--color-fondo); border: 1px solid var(--color-borde); border-radius: 6px; color: var(--color-texto); outline: none;">
            </div>
            <div id="contenedor-tabla-clientes">
                <p style="padding: 15px; color: var(--color-texto-suave); text-align: center;">Cargando clientes...</p>
            </div>
        </div>
    `;

                    let listaClientesGlobal = [];
                    // Conjunto para almacenar los IDs de los clientes eliminados de la vista principal en esta sesión
                    let idsClientesEliminados = JSON.parse(localStorage.getItem('clientesEliminadosUI') || '[]');

                    function cargarClientes() {
                        return fetch('https://la-micho-heladeria-backend.onrender.com/api/Clientes')
                            .then(response => response.json())
                            .then(clientes => {
                                // Filtramos para excluir permanentemente de la vista aquellos cuyo ID esté en la lista de eliminados
                                listaClientesGlobal = clientes.filter(c => !idsClientesEliminados.includes(c.id));
                                renderizarTablaClientes(listaClientesGlobal);
                            })
                            .catch(error => {
                                console.error('Error al cargar los clientes:', error);
                                document.getElementById('contenedor-tabla-clientes').innerHTML = '<p style="padding: 15px; color: var(--color-peligro); text-align: center;">Error al cargar los clientes.</p>';
                            });
                    }

                    function renderizarTablaClientes(clientesAMostrar) {
                        const contenedor = document.getElementById('contenedor-tabla-clientes');

                        if (clientesAMostrar.length === 0) {
                            contenedor.innerHTML = '<p style="padding: 15px; text-align: center; color: var(--color-texto-suave);">No hay clientes para mostrar.</p>';
                            return;
                        }

                        let tablaHTML = `
            <div class="tabla-responsive">
                <table style="width:100%; border-collapse: collapse; margin-top:5px; text-align: left; color: var(--color-texto);">
                    <thead>
                        <tr style="background-color: var(--color-secundario); color: var(--color-texto); border-bottom: 2px solid var(--color-primario);">
                            <th style="padding: 12px;">ID</th>
                            <th style="padding: 12px;">Cedula</th>
                            <th style="padding: 12px;">Nombre</th>
                            <th style="padding: 12px;">Teléfono</th>
                            <th style="padding: 12px;">E-mail</th>
                            <th style="padding: 12px; text-align: center;">Acciones</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

                        clientesAMostrar.forEach(cli => {
                            tablaHTML += `
                <tr style="border-bottom: 1px solid var(--color-borde); transition: background 0.2s;">
                    <td style="padding: 12px; color: var(--color-texto-suave);">${escaparHTML(cli.id)}</td>
                    <td style="padding: 12px;">${escaparHTML(cli.cedula)}</td>
                    <td style="padding: 12px; font-weight: 500;">${escaparHTML(cli.nombre)}</td>
                    <td style="padding: 12px; color: var(--color-texto-suave);">${escaparHTML(cli.telefono || 'N/A')}</td>
                    <td style="padding: 12px; color: var(--color-texto-suave);">${escaparHTML(cli.email || 'N/A')}</td>
                    <td style="padding: 12px; text-align: center;">
                        <div style="display: flex; gap: 6px; justify-content: center;">
                            <button class="btn-editar-cliente" data-id="${escaparHTML(cli.id)}" data-cedula="${escaparHTML(cli.cedula)}" data-nombre="${escaparHTML(cli.nombre)}" data-telefono="${escaparHTML(cli.telefono || '')}" data-email="${escaparHTML(cli.email || '')}" data-direccion="${escaparHTML(cli.direccion || '')}" style="padding: 6px 12px; background-color: var(--color-secundario); color: var(--color-texto); border: none; border-radius: 6px; cursor: pointer; font-weight: 500;">Editar</button>
                            <button class="btn-eliminar-cliente" data-id="${cli.id}" style="padding: 6px 12px; background-color: var(--color-peligro); color: var(--color-texto-invertido); border: none; border-radius: 6px; cursor: pointer; font-weight: 500;">Eliminar</button>
                        </div>
                    </td>
                </tr>
            `;
                        });

                        tablaHTML += `</tbody></table></div>`;
                        contenedor.innerHTML = tablaHTML;

                        // Evento para Editar (Desplegar acordeón)
                        document.querySelectorAll('.btn-editar-cliente').forEach(btn => {
                            btn.addEventListener('click', (e) => {
                                const id = e.target.getAttribute('data-id');
                                const cedula = e.target.getAttribute('data-cedula');
                                const nombre = e.target.getAttribute('data-nombre');
                                const telefono = e.target.getAttribute('data-telefono');
                                const email = e.target.getAttribute('data-email');
                                const direccion = e.target.getAttribute('data-direccion');

                                document.getElementById('card-formulario-cliente').style.display = 'block';
                                document.getElementById('edit-cliente-id').value = id;
                                document.getElementById('edit-cliente-cedula').value = cedula;
                                document.getElementById('edit-cliente-nombre').value = nombre;
                                document.getElementById('edit-cliente-telefono').value = telefono;
                                document.getElementById('edit-cliente-email').value = email;
                                document.getElementById('edit-cliente-direccion').value = direccion;

                                window.scrollTo({ top: 0, behavior: 'smooth' });
                            });
                        });

                        // Evento para Eliminar de la lista principal (permanente en la vista, intacto en la base de datos)
                        document.querySelectorAll('.btn-eliminar-cliente').forEach(btn => {
                            btn.addEventListener('click', (e) => {
                                const idCliente = parseInt(e.target.getAttribute('data-id'));

                                if (confirm('¿Estás seguro de que deseas eliminar este cliente de la lista? (Permanecerá guardado en la base de datos por seguridad de las ventas).')) {
                                    if (!idsClientesEliminados.includes(idCliente)) {
                                        idsClientesEliminados.push(idCliente);
                                        localStorage.setItem('clientesEliminadosUI', JSON.stringify(idsClientesEliminados));
                                    }

                                    listaClientesGlobal = listaClientesGlobal.filter(c => c.id !== idCliente);

                                    // Validar si hay texto en el buscador para aplicar el filtro actual
                                    const textoBusqueda = document.getElementById('input-buscar-cliente-tabla').value.toLowerCase().trim();
                                    if (textoBusqueda) {
                                        const filtrados = listaClientesGlobal.filter(cli =>
                                            cli.cedula.toLowerCase().includes(textoBusqueda) ||
                                            cli.nombre.toLowerCase().includes(textoBusqueda)
                                        );
                                        renderizarTablaClientes(filtrados);
                                    } else {
                                        renderizarTablaClientes(listaClientesGlobal);
                                    }

                                    alert('Cliente eliminado de la lista principal con éxito.');
                                }
                            });
                        });
                    }

                    cargarClientes();

                    setTimeout(() => {

                        if (miRender !== contadorRender) return; // Se dibujó otra sección: no enlazar dos veces
                        // Buscador en tiempo real por Cédula o Nombre
                        const inputBusqueda = document.getElementById('input-buscar-cliente-tabla');
                        if (inputBusqueda) {
                            inputBusqueda.addEventListener('input', (e) => {
                                const texto = e.target.value.toLowerCase().trim();
                                const resultados = listaClientesGlobal.filter(cli =>
                                    cli.cedula.toLowerCase().includes(texto) ||
                                    cli.nombre.toLowerCase().includes(texto)
                                );
                                renderizarTablaClientes(resultados);
                            });
                        }

                        // 1. Registrar Nuevo Cliente con validación de error (Cédula duplicada)
                        const formCliente = document.getElementById('form-cliente');
                        if (formCliente) {
                            formCliente.addEventListener('submit', (e) => {
                                e.preventDefault();
                                const liberar = bloquearEnvio(formCliente, formCliente.querySelector('button[type="submit"]'));
                                if (!liberar) return;

                                const nuevoCliente = {
                                    nombre: document.getElementById('nombre-cliente').value,
                                    cedula: document.getElementById('cedula-cliente').value,
                                    telefono: document.getElementById('telefono-cliente').value,
                                    email: document.getElementById('email-cliente').value,
                                    direccion: document.getElementById('direccion-cliente').value
                                };

                                fetch('https://la-micho-heladeria-backend.onrender.com/api/Clientes', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify(nuevoCliente)
                                })
                                    .then(leerRespuesta)
                                    .then(respuesta => {
                                        if (respuesta.ok) {
                                            formCliente.reset();
                                            // yaExistia: era un envío repetido del mismo cliente; ya está guardado
                                            const aviso = respuesta.datos && respuesta.datos.yaExistia ? respuesta.datos.mensaje : '¡Creado con éxito!';
                                            cargarClientes().then(() => alert(aviso));
                                        } else {
                                            alert(mensajeDe(respuesta));
                                        }
                                    })
                                    .catch(err => {
                                        console.error('Error en POST Cliente:', err);
                                        alert('No se pudo contactar al servidor. Revise la lista de clientes antes de reintentar.');
                                    })
                                    .finally(liberar);
                            });
                        }

                        // 2. Editar / Actualizar Cliente Existente
                        const formEditarCliente = document.getElementById('form-editar-cliente');
                        const btnCancelarEditCliente = document.getElementById('btn-cancelar-edit-cliente');

                        if (btnCancelarEditCliente) {
                            btnCancelarEditCliente.addEventListener('click', () => {
                                document.getElementById('card-formulario-cliente').style.display = 'none';
                                formEditarCliente.reset();
                            });
                        }

                        if (formEditarCliente) {
                            formEditarCliente.addEventListener('submit', (e) => {
                                e.preventDefault();
                                const liberar = bloquearEnvio(formEditarCliente, formEditarCliente.querySelector('button[type="submit"]'));
                                if (!liberar) return;
                                const id = document.getElementById('edit-cliente-id').value;

                                const clienteActualizado = {
                                    id: parseInt(id),
                                    nombre: document.getElementById('edit-cliente-nombre').value,
                                    cedula: document.getElementById('edit-cliente-cedula').value,
                                    telefono: document.getElementById('edit-cliente-telefono').value,
                                    email: document.getElementById('edit-cliente-email').value,
                                    direccion: document.getElementById('edit-cliente-direccion').value
                                };

                                fetch(`https://la-micho-heladeria-backend.onrender.com/api/Clientes/${id}`, {
                                    method: 'PUT',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify(clienteActualizado)
                                })
                                    .then(leerRespuesta)
                                    .then(respuesta => {
                                        if (respuesta.ok) {
                                            document.getElementById('card-formulario-cliente').style.display = 'none';
                                            formEditarCliente.reset();
                                            cargarClientes().then(() => alert('¡Cliente actualizado con éxito!'));
                                        } else {
                                            alert('Error al actualizar: ' + mensajeDe(respuesta));
                                        }
                                    })
                                    .catch(err => console.error('Error en PUT Cliente:', err))
                                    .finally(liberar);
                            });
                        }
                    }, 100);
                    break;
                case 'pos':
                    sectionTitle.textContent = 'Punto de Venta (POS)';
                    // [MODIFICACIÓN UI/UX]: Rejilla POS adaptada a modo oscuro, contrastes correctos y tarjetas estilizadas
                    contentBody.innerHTML = `
        <div class="grid-pos">
            <div class="card">
                <h3 style="color: var(--color-texto);">Seleccionar Productos</h3>
                <div class="fila-agregar-producto" style="display: flex; flex-wrap: wrap; gap: 10px; margin-top: 15px; margin-bottom: 15px;">
                    <div style="flex: 2 1 220px; position: relative;">
                        <input type="text" id="input-buscar-producto" placeholder="Escribe para buscar por iniciales o nombre..." list="lista-sugerencias-productos" style="width: 100%; padding: 10px 12px; background: var(--color-fondo); border: 1px solid var(--color-borde); border-radius: 6px; color: var(--color-texto); box-sizing: border-box; outline: none;">
                        <datalist id="lista-sugerencias-productos">
                        </datalist>
                        <input type="hidden" id="producto-seleccionado-id" value="">
                    </div>
                    <input type="number" id="cantidad-producto" value="1" min="1" style="padding: 10px; width: 80px; background: var(--color-fondo); border: 1px solid var(--color-borde); border-radius: 6px; color: var(--color-texto); text-align: center; outline: none;">
                    <button type="button" id="btn-agregar-carrito" style="padding: 10px 18px; background: var(--color-primario-boton); color: var(--color-texto-invertido); border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">Agregar</button>
                </div>
                <h4 style="color: var(--color-texto); margin-top: 20px; margin-bottom: 10px;">Carrito de Compras</h4>
                <div class="tabla-responsive">
                    <table style="width:100%; border-collapse: collapse; text-align: left; color: var(--color-texto);">
                        <thead>
                            <tr style="background-color: var(--color-secundario); color: var(--color-texto); border-bottom: 2px solid var(--color-primario);">
                                <th style="padding: 10px;">Producto</th>
                                <th style="padding: 10px;">Precio</th>
                                <th style="padding: 10px; text-align: center;">Cantidad</th>
                                <th style="padding: 10px;">Subtotal</th> 
                                <th style="padding: 10px; text-align: center;">Acciones</th>
                            </tr>
                        </thead>
                        <tbody id="carrito-body">
                            <tr><td colspan="5" style="padding: 15px; text-align: center; color: var(--color-texto-suave);">No hay productos en el carrito.</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>
            <div class="card">
                <h3 style="color: var(--color-texto);">Datos de la venta</h3>
                <div style="margin-top: 15px; margin-bottom: 15px;">
                    <label style="display: block; margin-bottom: 5px; font-weight: 500; color: var(--color-texto-suave); font-size: 0.9rem;">Buscar Cliente (Opcional):</label>
                    <div style="display: flex; gap: 8px;">
                        <input type="text" id="busqueda-cedula" placeholder="Digite la cédula..." style="padding: 10px 12px; background: var(--color-fondo); border: 1px solid var(--color-borde); border-radius: 6px; color: var(--color-texto); flex: 1; outline: none;">
                        <button type="button" id="btn-buscar-cliente" style="padding: 10px 14px; background-color: var(--color-secundario); color: var(--color-texto); border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">Buscar</button>
                    </div>
                </div>

                <div id="info-cliente-container" style="margin-bottom: 15px; padding: 12px; background: var(--color-exito-suave); border-radius: 6px; border: 1px solid var(--color-exito); display: none;">
                    <p style="margin: 0; color: var(--color-exito); font-weight: 500;" id="texto-cliente-encontrado"></p>
                    <button type="button" id="btn-cambiar-cliente" style="margin-top: 6px; background: none; border: none; color: var(--color-primario-texto); cursor: pointer; padding: 0; font-size: 0.85rem;">Cambiar cliente</button>
                </div>

                <div id="form-nuevo-cliente-pos" style="margin-bottom: 15px; padding: 12px; background: var(--color-acento-suave); border-radius: 6px; border: 1px solid var(--color-acento); display: none;">
                    <h4 style="margin: 0 0 8px 0; color: var(--color-advertencia-texto); font-size: 0.95rem;">Cliente no encontrado. Regístrese aquí:</h4>
                    <input type="text" id="pos-nuevo-nombre" placeholder="Nombre completo" required style="width: 100%; padding: 8px 10px; background: var(--color-fondo); border: 1px solid var(--color-borde); border-radius: 6px; color: var(--color-texto); margin-bottom: 8px; box-sizing: border-box; outline: none;">
                    <input type="text" id="pos-nuevo-telefono" placeholder="Número de teléfono" required style="width: 100%; padding: 8px 10px; background: var(--color-fondo); border: 1px solid var(--color-borde); border-radius: 6px; color: var(--color-texto); margin-bottom: 8px; box-sizing: border-box; outline: none;">
                    <input type="email" id="pos-nuevo-email" placeholder="Correo electrónico" style="width: 100%; padding: 8px 10px; background: var(--color-fondo); border: 1px solid var(--color-borde); border-radius: 6px; color: var(--color-texto); margin-bottom: 8px; box-sizing: border-box; outline: none;">
                    <input type="text" id="pos-nuevo-direccion" placeholder="Dirección" required style="width: 100%; padding: 8px 10px; background: var(--color-fondo); border: 1px solid var(--color-borde); border-radius: 6px; color: var(--color-texto); margin-bottom: 8px; box-sizing: border-box; outline: none;">
                    <button type="button" id="btn-registrar-rapido" style="width: 100%; padding: 9px; background-color: var(--color-acento); color: var(--color-texto); border: none; border-radius: 6px; font-weight: 600; cursor: pointer;">Registrar y Seleccionar</button>
                </div>

                <input type="hidden" id="cliente-seleccionado-id" value="">

                <div style="background-color: var(--color-fondo); padding: 15px; border-radius: 8px; margin-bottom: 15px; border: 1px solid var(--color-borde);">
                    <h4 style="margin: 0 0 10px 0; color: var(--color-texto);">Resumen y Pago</h4>
                    <p style="font-size: 1.2rem; font-weight: bold; margin: 0 0 12px 0; color: var(--color-primario-texto);">Total: $<span id="span-total">0.00</span></p>
                    
                    <div style="margin-bottom: 10px;">
                        <label style="display: block; font-size: 0.85rem; margin-bottom: 4px; font-weight: 500; color: var(--color-texto-suave);">Método de Pago:</label>
                        <select id="select-metodo-pago" style="width: 100%; padding: 9px; background: var(--color-superficie); border: 1px solid var(--color-borde); border-radius: 6px; color: var(--color-texto); margin-bottom: 10px; box-sizing: border-box; outline: none;">
                            <option value="Efectivo" style="background: var(--color-superficie); color: var(--color-texto);">Efectivo</option>
                            <option value="Transferencia" style="background: var(--color-superficie); color: var(--color-texto);">Transferencia</option>
                            <option value="Datáfono" style="background: var(--color-superficie); color: var(--color-texto);">Datáfono</option>
                        </select>

                        <label style="display: block; font-size: 0.85rem; margin-bottom: 4px; font-weight: 500; color: var(--color-texto-suave);">Monto Recibido / Pagado:</label>
                        <input type="number" id="input-monto-pago" placeholder="0.00" style="width: 100%; padding: 9px; background: var(--color-superficie); border: 1px solid var(--color-borde); border-radius: 6px; color: var(--color-texto); box-sizing: border-box; outline: none;" min="0" step="0.01">
                    </div>
                    
                    <p style="font-size: 1rem; font-weight: bold; margin: 12px 0 0 0; color: var(--color-exito);">Cambio (Vueltos): $<span id="span-cambio">0.00</span></p>
                </div>
                <button type="button" id="btn-procesar-venta" style="width: 100%; padding: 12px; background: var(--color-primario-boton); color: var(--color-texto-invertido); border: none; border-radius: 6px; font-weight: 600; cursor: pointer; margin-bottom: 8px; box-shadow: var(--sombra-boton);">Procesar Venta</button>
                <button type="button" id="btn-cancelar-venta" style="width: 100%; padding: 10px; background-color: var(--color-superficie); color: var(--color-texto); border: 1px solid var(--color-borde-fuerte); border-radius: 6px; font-weight: 600; cursor: pointer;">Cancelar Venta</button>
            </div>
        </div>
    `;

                    let carrito = [];
                    // Venta enviada pero sin confirmación exitosa: { huella, clave }. Mientras el contenido de la
                    // venta no cambie se reutiliza la misma clave, así un reenvío nunca crea una venta duplicada.
                    let ventaPendiente = null;
                    let productosGlobal = [];
                    let clientesGlobal = [];

                    function renderizarDatalistProductos(listaProductos) {
                        const datalist = document.getElementById('lista-sugerencias-productos');
                        datalist.innerHTML = '';
                        listaProductos.forEach(p => {
                            datalist.innerHTML += `<option value="${escaparHTML(`${p.nombre} - $${p.precio} (Stock: ${p.stock})`)}">`;
                        });
                    }

                    function cargarDatosPOS() {
                        const productos = fetch('https://la-micho-heladeria-backend.onrender.com/api/Productos')
                            .then(res => res.json())
                            .then(data => {
                                if (Array.isArray(data)) {
                                    productosGlobal = data;
                                    renderizarDatalistProductos(productosGlobal);
                                }
                            })
                            .catch(err => console.error('Error al recargar productos del POS:', err));

                        const clientes = fetch('https://la-micho-heladeria-backend.onrender.com/api/Clientes')
                            .then(res => res.json())
                            .then(data => {
                                if (Array.isArray(data)) clientesGlobal = data;
                            })
                            .catch(err => console.error('Error al recargar clientes del POS:', err));

                        return Promise.all([productos, clientes]);
                    }

                    cargarDatosPOS();

                    setTimeout(() => {

                        if (miRender !== contadorRender) return; // Se dibujó otra sección: no enlazar dos veces
                        const btnAgregar = document.getElementById('btn-agregar-carrito');
                        const btnProcesar = document.getElementById('btn-procesar-venta');
                        const btnCancelarVenta = document.getElementById('btn-cancelar-venta');
                        const btnBuscarCliente = document.getElementById('btn-buscar-cliente');
                        const inputBusquedaCedula = document.getElementById('busqueda-cedula');
                        const infoClienteContainer = document.getElementById('info-cliente-container');
                        const textoClienteEncontrado = document.getElementById('texto-cliente-encontrado');
                        const formNuevoClientePos = document.getElementById('form-nuevo-cliente-pos');
                        const clienteSeleccionadoIdInput = document.getElementById('cliente-seleccionado-id');
                        const btnRegistrarRapido = document.getElementById('btn-registrar-rapido');
                        const btnCambiarCliente = document.getElementById('btn-cambiar-cliente');

                        const inputBuscarProducto = document.getElementById('input-buscar-producto');
                        const productoSeleccionadoIdInput = document.getElementById('producto-seleccionado-id');
                        const inputMontoPago = document.getElementById('input-monto-pago');
                        const selectMetodoPago = document.getElementById('select-metodo-pago');
                        const spanCambio = document.getElementById('span-cambio');
                        const spanTotal = document.getElementById('span-total');

                        inputBuscarProducto.addEventListener('input', () => {
                            const valorEscrito = inputBuscarProducto.value.trim();
                            const productoEncontrado = productosGlobal.find(p =>
                                valorEscrito.includes(p.nombre) || p.nombre.toLowerCase() === valorEscrito.toLowerCase()
                            );

                            if (productoEncontrado) {
                                productoSeleccionadoIdInput.value = productoEncontrado.id;
                            } else {
                                productoSeleccionadoIdInput.value = '';
                            }
                        });

                        function calcularCambio() {
                            const totalGeneral = carrito.reduce((acc, item) => acc + (item.precioUnitario * item.cantidad), 0);
                            const montoPagado = parseFloat(inputMontoPago.value) || 0;
                            const cambio = montoPagado - totalGeneral;
                            spanCambio.textContent = cambio >= 0 ? cambio.toFixed(2) : '0.00';
                        }

                        inputMontoPago.addEventListener('input', calcularCambio);

                        btnBuscarCliente.addEventListener('click', () => {
                            const cedulaBuscada = inputBusquedaCedula.value.trim();
                            if (!cedulaBuscada) {
                                alert('Por favor ingrese un número de cédula para buscar.');
                                return;
                            }

                            const clienteEncontrado = clientesGlobal.find(c => c.cedula === cedulaBuscada);

                            if (clienteEncontrado) {
                                clienteSeleccionadoIdInput.value = clienteEncontrado.id;
                                textoClienteEncontrado.textContent = `✔ Cliente: ${clienteEncontrado.nombre} (Cédula: ${clienteEncontrado.cedula})`;
                                infoClienteContainer.style.display = 'block';
                                formNuevoClientePos.style.display = 'none';
                                inputBusquedaCedula.disabled = true;
                                btnBuscarCliente.disabled = true;
                            } else {
                                clienteSeleccionadoIdInput.value = '';
                                infoClienteContainer.style.display = 'none';
                                formNuevoClientePos.style.display = 'block';
                                alert('Cliente no encontrado. Puede registrarlo abajo de forma rápida o continuar sin cliente.');
                            }
                        });

                        btnCambiarCliente.addEventListener('click', () => {
                            clienteSeleccionadoIdInput.value = '';
                            infoClienteContainer.style.display = 'none';
                            inputBusquedaCedula.value = '';
                            inputBusquedaCedula.disabled = false;
                            btnBuscarCliente.disabled = false;
                        });

                        btnRegistrarRapido.addEventListener('click', () => {
                            const nombre = document.getElementById('pos-nuevo-nombre').value.trim();
                            const cedula = inputBusquedaCedula.value.trim();
                            const telefono = document.getElementById('pos-nuevo-telefono').value.trim();
                            const email = document.getElementById('pos-nuevo-email').value.trim();
                            const direccion = document.getElementById('pos-nuevo-direccion').value.trim();

                            if (!nombre || !cedula || !telefono || !direccion) {
                                alert('Por favor complete todos los campos para el registro del cliente.');
                                return;
                            }

                            const nuevoCliente = { nombre, cedula, telefono, email, direccion };

                            const liberar = bloquearEnvio(btnRegistrarRapido, btnRegistrarRapido, 'Registrando...');
                            if (!liberar) return;

                            fetch('https://la-micho-heladeria-backend.onrender.com/api/Clientes', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify(nuevoCliente)
                            })
                                .then(async res => ({ ...(await leerRespuesta(res)), status: res.status }))
                                .then(respuesta => {
                                    const { ok, status, datos } = respuesta;
                                    // 409 con "data": la cédula ya estaba registrada; se usa ese cliente
                                    const yaExistia = status === 409 && datos && datos.data && datos.data.id;
                                    if (!ok && !yaExistia) {
                                        throw new Error(mensajeDe(respuesta, 'Error al registrar el cliente.'));
                                    }

                                    const cliente = datos && datos.data;
                                    if (cliente && cliente.id && !clientesGlobal.some(c => c.id === cliente.id)) {
                                        clientesGlobal.push(cliente);
                                    }

                                    // Limpiar los campos del registro rápido
                                    ['pos-nuevo-nombre', 'pos-nuevo-telefono', 'pos-nuevo-email', 'pos-nuevo-direccion']
                                        .forEach(idCampo => { document.getElementById(idCampo).value = ''; });
                                    formNuevoClientePos.style.display = 'none';
                                    if (cliente && cliente.id) {
                                        clienteSeleccionadoIdInput.value = cliente.id;
                                        textoClienteEncontrado.textContent = `✔ Cliente ${yaExistia || (datos && datos.yaExistia) ? 'Existente' : 'Registrado'} y Seleccionado: ${cliente.nombre} (Cédula: ${cliente.cedula})`;
                                        infoClienteContainer.style.display = 'block';
                                        inputBusquedaCedula.disabled = true;
                                        btnBuscarCliente.disabled = true;
                                    }
                                    const yaRegistrado = yaExistia || (datos && datos.yaExistia);
                                    alert(yaRegistrado ? `${datos.mensaje}\nSe seleccionó ese cliente para la venta.` : '¡Creado con éxito!');
                                })
                                .catch(err => {
                                    console.error('Error:', err);
                                    alert('No se pudo registrar el cliente: ' + err.message);
                                })
                                .finally(liberar);
                        });

                        btnAgregar.addEventListener('click', () => {
                            const prodId = parseInt(productoSeleccionadoIdInput.value);
                            const cantidad = parseInt(document.getElementById('cantidad-producto').value);

                            if (!prodId) {
                                alert('Por favor seleccione o escriba un producto válido de la lista.');
                                return;
                            }
                            if (cantidad <= 0) {
                                alert('La cantidad debe ser mayor a 0.');
                                return;
                            }

                            const productoInfo = productosGlobal.find(p => p.id === prodId);
                            if (!productoInfo) return;

                            if (productoInfo.stock < cantidad) {
                                alert(`Stock insuficiente. Stock disponible: ${productoInfo.stock}`);
                                return;
                            }

                            const itemExistente = carrito.find(item => item.idProducto === prodId);
                            if (itemExistente) {
                                if (productoInfo.stock < (itemExistente.cantidad + cantidad)) {
                                    alert('No hay suficiente stock para agregar más unidades.');
                                    return;
                                }
                                itemExistente.cantidad += cantidad;
                            } else {
                                carrito.push({
                                    idProducto: prodId,
                                    nombre: productoInfo.nombre,
                                    precioUnitario: productoInfo.precio,
                                    cantidad: cantidad
                                });
                            }

                            actualizarCarritoUI();

                            document.getElementById('cantidad-producto').value = '1';
                            inputBuscarProducto.value = '';
                            productoSeleccionadoIdInput.value = '';
                        });

                        function actualizarCarritoUI() {
                            const tbody = document.getElementById('carrito-body');
                            tbody.innerHTML = '';

                            if (carrito.length === 0) {
                                tbody.innerHTML = '<tr><td colspan="5" style="padding: 15px; text-align: center; color: var(--color-texto-suave);">No hay productos en el carrito.</td></tr>';
                                spanTotal.textContent = '0.00';
                                spanCambio.textContent = '0.00';
                                return;
                            }

                            let totalGeneral = 0;
                            carrito.forEach((item, index) => {
                                const subtotal = item.precioUnitario * item.cantidad;
                                totalGeneral += subtotal;
                                tbody.innerHTML += `
                    <tr style="border-bottom: 1px solid var(--color-borde);">
                        <td style="padding: 10px;">${escaparHTML(item.nombre)}</td>
                        <td style="padding: 10px; color: var(--color-exito);">$${escaparHTML(item.precioUnitario)}</td>
                        <td style="padding: 10px; text-align: center;">
                            <input type="number" class="input-cambiar-cantidad" data-index="${index}" value="${item.cantidad}" min="1" style="width: 60px; padding: 4px; background: var(--color-fondo); border: 1px solid var(--color-borde); border-radius: 4px; color: var(--color-texto); text-align: center; outline: none;">
                        </td>
                        <td style="padding: 10px; color: var(--color-primario-texto);">$${subtotal.toFixed(2)}</td>
                        <td style="padding: 10px; text-align: center;">
                            <button type="button" class="btn-eliminar-item" data-index="${index}" style="padding: 5px 10px; background-color: var(--color-peligro); color: var(--color-texto-invertido); border: none; border-radius: 6px; cursor: pointer; font-weight: 500;">Quitar</button>
                        </td>
                    </tr>
                `;
                            });

                            spanTotal.textContent = totalGeneral.toFixed(2);
                            calcularCambio();

                            document.querySelectorAll('.input-cambiar-cantidad').forEach(input => {
                                input.addEventListener('change', (e) => {
                                    const index = e.target.getAttribute('data-index');
                                    const nuevaCantidad = parseInt(e.target.value);
                                    const productoInfo = productosGlobal.find(p => p.id === carrito[index].idProducto);

                                    if (nuevaCantidad <= 0 || isNaN(nuevaCantidad)) {
                                        alert('La cantidad debe ser al menos 1.');
                                        e.target.value = carrito[index].cantidad;
                                        return;
                                    }

                                    if (productoInfo && productoInfo.stock < nuevaCantidad) {
                                        alert(`Stock insuficiente. Stock disponible: ${productoInfo.stock}`);
                                        e.target.value = carrito[index].cantidad;
                                        return;
                                    }

                                    carrito[index].cantidad = nuevaCantidad;
                                    actualizarCarritoUI();
                                });
                            });

                            document.querySelectorAll('.btn-eliminar-item').forEach(btn => {
                                btn.addEventListener('click', (e) => {
                                    const index = e.target.getAttribute('data-index');
                                    carrito.splice(index, 1);
                                    actualizarCarritoUI();
                                });
                            });
                        }

                        btnCancelarVenta.addEventListener('click', () => {
                            if (carrito.length === 0 && !clienteSeleccionadoIdInput.value) {
                                alert('No hay una venta en proceso para cancelar.');
                                return;
                            }

                            if (confirm('¿Estás seguro de que deseas cancelar el proceso de venta actual? Se perderán los datos ingresados.')) {
                                carrito = [];
                                actualizarCarritoUI();

                                clienteSeleccionadoIdInput.value = '';
                                infoClienteContainer.style.display = 'none';
                                formNuevoClientePos.style.display = 'none';
                                inputBusquedaCedula.value = '';
                                inputBusquedaCedula.disabled = false;
                                btnBuscarCliente.disabled = false;

                                inputBuscarProducto.value = '';
                                productoSeleccionadoIdInput.value = '';
                                document.getElementById('cantidad-producto').value = '1';
                                inputMontoPago.value = '';
                                spanCambio.textContent = '0.00';

                                alert('Venta cancelada con éxito.');
                            }
                        });

                        btnProcesar.addEventListener('click', () => {
                            // Un pago en curso ignora cualquier clic adicional (antes de cualquier otra validación)
                            if (btnProcesar.dataset.enviando === 'true') return;

                            const clienteIdRaw = clienteSeleccionadoIdInput.value.trim();
                            const clienteId = clienteIdRaw ? parseInt(clienteIdRaw) : null;

                            if (carrito.length === 0) {
                                alert('El carrito de compras está vacío.');
                                return;
                            }

                            const totalGeneral = carrito.reduce((acc, item) => acc + (item.precioUnitario * item.cantidad), 0);
                            const montoPagado = parseFloat(inputMontoPago.value) || 0;
                            const metodoSeleccionado = selectMetodoPago.value;

                            if (montoPagado < totalGeneral) {
                                alert('El monto pagado es menor al total de la venta.');
                                return;
                            }

                            const cambio = montoPagado - totalGeneral;

                            const ventaData = {
                                idCliente: clienteId,
                                metodoPago: metodoSeleccionado,
                                detalleVenta: carrito.map(item => ({
                                    idProducto: item.idProducto,
                                    cantidad: item.cantidad
                                }))
                            };

                            // Clave de idempotencia: UUID nuevo por cada venta distinta. Si esta misma venta ya se
                            // envió y no se confirmó (fallo de red), se reutiliza su clave para no duplicarla.
                            const cuerpoVenta = JSON.stringify(ventaData);
                            if (!ventaPendiente || ventaPendiente.huella !== cuerpoVenta) {
                                ventaPendiente = { huella: cuerpoVenta, clave: generarUUID() };
                            }

                            // Bloqueo inmediato contra doble clic / doble cobro mientras Render responde.
                            // Aun si llegara un segundo envío, la clave de idempotencia evita duplicar la venta.
                            const liberarPago = bloquearEnvio(btnProcesar, btnProcesar, 'Procesando pago...');
                            if (!liberarPago) return;

                            fetchConReintentos('https://la-micho-heladeria-backend.onrender.com/api/Ventas', {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'X-Idempotency-Key': ventaPendiente.clave
                                },
                                body: cuerpoVenta
                            })
                                .then(async res => ({ ...(await leerRespuesta(res)), status: res.status, repetida: res.headers.get('Idempotent-Replayed') === 'true' }))
                                .then(async ({ ok, status, texto, datos, repetida }) => {
                                    if (!ok) {
                                        // 422: la clave ya se usó con otros datos; la próxima vez se genera una nueva
                                        if (status === 422) ventaPendiente = null;
                                        alert('Error al procesar la venta: ' + ((datos && datos.mensaje) || texto));
                                        return;
                                    }

                                    // Venta confirmada: la siguiente venta usará una clave nueva
                                    ventaPendiente = null;

                                    // Stock ya descontado que devuelve el backend: se aplica al instante
                                    if (datos && Array.isArray(datos.productosActualizados)) {
                                        datos.productosActualizados.forEach(({ id, stock }) => {
                                            const prod = productosGlobal.find(p => p.id === id);
                                            if (prod) prod.stock = stock;
                                        });
                                        renderizarDatalistProductos(productosGlobal);
                                    }

                                    carrito = [];
                                    inputMontoPago.value = '';
                                    actualizarCarritoUI();
                                    clienteSeleccionadoIdInput.value = '';
                                    infoClienteContainer.style.display = 'none';
                                    formNuevoClientePos.style.display = 'none';
                                    inputBusquedaCedula.value = '';
                                    inputBusquedaCedula.disabled = false;
                                    btnBuscarCliente.disabled = false;

                                    // Confirmación inmediata: el stock ya quedó aplicado con productosActualizados.
                                    // Antes se esperaba recargar TODOS los productos y clientes antes de avisar
                                    // (dos listados completos más contra Render/Supabase); ahora se refrescan
                                    // en segundo plano, después del aviso.
                                    liberarPago();
                                    const avisoRepetida = repetida ? '\n(Esta venta ya se había registrado: no se duplicó.)' : '';
                                    alert(`¡Venta procesada con éxito!\nMétodo: ${metodoSeleccionado}\nCambio a devolver: $${cambio.toFixed(2)}${avisoRepetida}`);
                                    cargarDatosPOS();
                                })
                                .catch(error => {
                                    console.error('Error en POST Venta:', error);
                                    alert('No se pudo confirmar la venta por un problema de conexión.\nPresione "Procesar" de nuevo sin cambiar el carrito: se reenviará con la misma clave y, si ya se había guardado, no se duplicará.');
                                })
                                .finally(liberarPago);
                        });
                    }, 100);
                    break;

                case 'ventas-dia':
                    sectionTitle.textContent = 'Ventas del Día';
                    contentBody.innerHTML = `

      <!-- Tarjeta del Gran Total Global -->
        <div class="card" style="margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; background: linear-gradient(135deg, var(--color-primario-suave), var(--color-secundario-suave));">
            <h3 style="color: var(--color-texto); margin: 0; font-size: 1.1rem;"> Ventas del Día</h3>
            <span id="total-ventas-dia" style="color: var(--color-primario-texto); font-size: 1.4rem; font-weight: bold;">$0.00</span>
        </div>

        <!-- Tarjetas de resumen desglosadas por método de pago -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 20px;">
            <div class="card" style="margin-bottom: 0; padding: 15px; border-left: 4px solid var(--color-secundario-fuerte);">
                <span style="font-size: 0.85rem; color: var(--color-texto-suave); font-weight: 500;">Total Efectivo</span>
                <div id="total-efectivo" style="font-size: 1.3rem; font-weight: bold; color: var(--color-texto); margin-top: 5px;">$0.00</div>
            </div>
            <div class="card" style="margin-bottom: 0; padding: 15px; border-left: 4px solid var(--color-primario);">
                <span style="font-size: 0.85rem; color: var(--color-texto-suave); font-weight: 500;">Total Transferencia</span>
                <div id="total-transferencia" style="font-size: 1.3rem; font-weight: bold; color: var(--color-texto); margin-top: 5px;">$0.00</div>
            </div>
            <div class="card" style="margin-bottom: 0; padding: 15px; border-left: 4px solid var(--color-acento);">
                <span style="font-size: 0.85rem; color: var(--color-texto-suave); font-weight: 500;">Total Datáfono</span>
                <div id="total-datafono" style="font-size: 1.3rem; font-weight: bold; color: var(--color-texto); margin-top: 5px;">$0.00</div>
            </div>
        </div>

      

        <!-- Contenedor de listas desplegables por Método de Pago -->
        <div class="card">
            <h3 style="color: var(--color-texto); margin-bottom: 15px;">Desglose de Facturas por Método de Pago</h3>
            <div id="contenedor-desglose-metodos">
                <p style="padding: 15px; color: var(--color-texto-suave); text-align: center;">Cargando ventas del día...</p>
            </div>
        </div>
    `;

                    function cargarVentasDelDia() {
                        const fechaLocal = new Date().toLocaleDateString('en-CA');

                        fetch(`https://la-micho-heladeria-backend.onrender.com/api/Ventas/PorFecha?fecha=${fechaLocal}`)
                            .then(res => res.json())
                            .then(ventas => {
                                const contenedor = document.getElementById('contenedor-desglose-metodos');
                                const spanTotalDia = document.getElementById('total-ventas-dia');
                                const spanEfectivo = document.getElementById('total-efectivo');
                                const spanTransferencia = document.getElementById('total-transferencia');
                                const spanDatafono = document.getElementById('total-datafono');

                                if (!ventas || ventas.length === 0) {
                                    contenedor.innerHTML = '<p style="padding: 15px; text-align: center; color: var(--color-texto-suave);">No se han registrado ventas el día de hoy.</p>';
                                    spanTotalDia.textContent = '$0.00';
                                    spanEfectivo.textContent = '$0.00';
                                    spanTransferencia.textContent = '$0.00';
                                    spanDatafono.textContent = '$0.00';
                                    return;
                                }

                                // Clasificamos y calculamos totales por método de pago
                                let grupos = {
                                    'Efectivo': [],
                                    'Transferencia': [],
                                    'Datáfono': []
                                };

                                let totalesGrupo = {
                                    'Efectivo': 0,
                                    'Transferencia': 0,
                                    'Datáfono': 0
                                };

                                let granTotalGlobal = 0;

                                ventas.forEach(venta => {
                                    const hora = venta.fecha ? venta.fecha.split('T')[1].substring(0, 5) : 'N/A';

                                    let totalVenta = 0;
                                    let listaProductosHTML = '<ul style="margin: 0; padding-left: 20px; color: var(--color-texto-suave);">';

                                    if (venta.detalleVenta && venta.detalleVenta.length > 0) {
                                        venta.detalleVenta.forEach(det => {
                                            const subtotal = det.cantidad * det.precioUnitario;
                                            totalVenta += subtotal;
                                            const prodNombre = det.idProductoNavigation ? det.idProductoNavigation.nombre : `ID: ${det.idProducto}`;
                                            listaProductosHTML += `<li style="margin-bottom: 4px;"><strong style="color: var(--color-texto);">${escaparHTML(prodNombre)}</strong> - Cantidad: ${escaparHTML(det.cantidad)} | Subtotal: <span style="color: var(--color-primario-texto);">$${subtotal.toFixed(2)}</span></li>`;
                                        });
                                    }
                                    listaProductosHTML += '</ul>';

                                    // Normalización robusta del método de pago
                                    let metodoOriginal = venta.metodoPago ? venta.metodoPago.trim().toLowerCase() : 'efectivo';
                                    let metodo = 'Efectivo';

                                    if (metodoOriginal.includes('transf') || metodoOriginal.includes('nequi') || metodoOriginal.includes('daviplata')) {
                                        metodo = 'Transferencia';
                                    } else if (metodoOriginal.includes('data') || metodoOriginal.includes('tarj') || metodoOriginal.includes('pos') || metodoOriginal.includes('datáfo')) {
                                        metodo = 'Datáfono';
                                    } else if (metodoOriginal.includes('efect') || metodoOriginal.includes('cash')) {
                                        metodo = 'Efectivo';
                                    } else {
                                        metodo = 'Efectivo';
                                    }

                                    if (!grupos[metodo]) {
                                        grupos[metodo] = [];
                                        totalesGrupo[metodo] = 0;
                                    }

                                    grupos[metodo].push({
                                        id: venta.id,
                                        hora: hora,
                                        total: totalVenta,
                                        productosHTML: listaProductosHTML
                                    });

                                    totalesGrupo[metodo] += totalVenta;
                                    granTotalGlobal += totalVenta;
                                });

                                // Actualizamos las tarjetas superiores
                                spanEfectivo.textContent = `$${totalesGrupo['Efectivo'].toFixed(2)}`;
                                spanTransferencia.textContent = `$${totalesGrupo['Transferencia'].toFixed(2)}`;
                                spanDatafono.textContent = `$${totalesGrupo['Datáfono'].toFixed(2)}`;
                                spanTotalDia.textContent = `$${granTotalGlobal.toFixed(2)}`;

                                // Construimos las listas desplegables principales por método de pago
                                let htmlDesglose = '<div style="display: flex; flex-direction: column; gap: 12px;">';

                                const metodosKeys = Object.keys(grupos);
                                metodosKeys.forEach(metodo => {
                                    const listaVentas = grupos[metodo];
                                    const subtotalMetodo = totalesGrupo[metodo];

                                    let colorBorde = 'var(--color-secundario-fuerte)';
                                    if (metodo === 'Transferencia') colorBorde = 'var(--color-primario)';
                                    if (metodo === 'Datáfono') colorBorde = 'var(--color-acento)';

                                    htmlDesglose += `
                        <details style="background: var(--color-fondo); border: 1px solid var(--color-borde); border-radius: 8px; overflow: hidden; border-left: 4px solid ${colorBorde};">
                            <summary style="padding: 14px 18px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; font-weight: 600; color: var(--color-texto); user-select: none; background: var(--color-superficie);">
                                <span>${metodo} <span style="font-size: 0.85rem; color: var(--color-texto-suave); font-weight: normal; margin-left: 8px;">(${listaVentas.length} transacciones)</span></span>
                                <span style="color: var(--color-texto); font-size: 1.05rem;">$${subtotalMetodo.toFixed(2)} ▼</span>
                            </summary>
                            <div class="tabla-responsive" style="padding: 15px 20px; border-top: 1px solid var(--color-borde); background: var(--color-fondo);">
                    `;

                                    if (listaVentas.length === 0) {
                                        htmlDesglose += `<p style="color: var(--color-texto-suave); font-size: 0.9rem; margin: 0; text-align: center;">No hay ventas registradas con este método.</p>`;
                                    } else {
                                        htmlDesglose += `
                            <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.9rem;">
                                <thead>
                                    <tr style="color: var(--color-texto-suave); border-bottom: 1px solid var(--color-borde);">
                                        <th style="padding: 8px;">Factura ID</th>
                                        <th style="padding: 8px;">Hora</th>
                                        <th style="padding: 8px; text-align: right;">Valor</th>
                                        <th style="padding: 8px; text-align: center;">Acción</th>
                                    </tr>
                                </thead>
                                <tbody>
                        `;

                                        listaVentas.forEach(item => {
                                            htmlDesglose += `
                                <tr style="border-bottom: 1px solid var(--color-borde);">
                                    <td style="padding: 10px 8px; color: var(--color-texto-suave);">#${item.id}</td>
                                    <td style="padding: 10px 8px; color: var(--color-texto);">${item.hora}</td>
                                    <td style="padding: 10px 8px; text-align: right; font-weight: 600; color: var(--color-exito);">$${item.total.toFixed(2)}</td>
                                    <td style="padding: 10px 8px; text-align: center;">
                                        <button class="btn-desplegar-detalle" data-id="${item.id}" style="background-color: var(--color-secundario); color: var(--color-texto); border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer; font-size: 0.8rem;">Ver Detalle ▼</button>
                                    </td>
                                </tr>
                                <tr id="detalle-factura-${item.id}" style="display: none; background-color: var(--color-fondo); border-bottom: 1px solid var(--color-borde);">
                                    <td colspan="4" style="padding: 12px 15px;">
                                        <div style="font-weight: 600; margin-bottom: 6px; color: var(--color-primario-texto); font-size: 0.85rem;">Productos de la Factura #${item.id}:</div>
                                        ${item.productosHTML}
                                    </td>
                                </tr>
                            `;
                                        });

                                        htmlDesglose += `
                                </tbody>
                            </table>
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 12px; padding-top: 10px; border-top: 1px dashed var(--color-borde); font-weight: bold;">
                                <span style="color: var(--color-texto-suave); font-size: 0.9rem;">Subtotal ${metodo}:</span>
                                <span style="color: ${colorBorde};">$${subtotalMetodo.toFixed(2)}</span>
                            </div>
                        `;
                                    }

                                    htmlDesglose += `
                            </div>
                        </details>
                    `;
                                });

                                htmlDesglose += `</div>`;
                                contenedor.innerHTML = htmlDesglose;

                                // Listener independiente para desplegar el detalle de cada factura individual
                                document.querySelectorAll('.btn-desplegar-detalle').forEach(btn => {
                                    btn.addEventListener('click', (e) => {
                                        const facturaId = e.target.getAttribute('data-id');
                                        const filaDetalle = document.getElementById(`detalle-factura-${facturaId}`);

                                        if (filaDetalle.style.display === 'none') {
                                            filaDetalle.style.display = 'table-row';
                                            e.target.textContent = 'Ocultar ▲';
                                            e.target.style.backgroundColor = 'var(--color-secundario-hover)';
                                        } else {
                                            filaDetalle.style.display = 'none';
                                            e.target.textContent = 'Ver Detalle ▼';
                                            e.target.style.backgroundColor = 'var(--color-secundario)';
                                        }
                                    });
                                });

                            })
                            .catch(err => {
                                console.error('Error al cargar ventas:', err);
                                document.getElementById('contenedor-desglose-metodos').innerHTML = '<p style="padding: 15px; color: var(--color-peligro); text-align: center;">Error al cargar el reporte de ventas.</p>';
                            });
                    }

                    cargarVentasDelDia();
                    break;

                case 'producto-mas-vendido':
                    sectionTitle.textContent = 'Producto Más Vendido';
                    contentBody.innerHTML = `
        <div class="grid-2" style="margin-bottom: 20px;">
            <div class="card">
                <h3 style="color: var(--color-texto); margin-bottom: 10px;">🏆 Producto con mayor demanda</h3>
                <div id="contenedor-producto-general" style="margin-top: 15px;">
                    <p style="color: var(--color-texto-suave); text-align: center; padding: 15px;">Cargando general...</p>
                </div>
            </div>
            <div class="card">
                <h3 style="color: var(--color-texto); margin-bottom: 10px;">📅 Más Vendido del Día</h3>
                <div style="margin-top: 10px; margin-bottom: 15px; display: flex; gap: 8px; align-items: center;">
                    <input type="date" id="filtro-fecha-estrella" style="padding: 9px 12px; background: var(--color-fondo); border: 1px solid var(--color-borde); border-radius: 6px; color: var(--color-texto); outline: none; flex: 1;">
                    <button type="button" id="btn-consultar-dia" style="padding: 10px 14px; background-color: var(--color-secundario); color: var(--color-texto); border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">Consultar</button>
                </div>
                <div id="contenedor-producto-diario">
                    <p style="color: var(--color-texto-suave); text-align: center; padding: 15px;">Cargando diario...</p>
                </div>
            </div>
        </div>

        <!-- Nueva Sección: Top 5 Productos más vendidos del día en barras -->
        <div class="card">
            <h3 style="color: var(--color-texto); margin-bottom: 15px;">📊 Top 5 Productos Más Vendidos del Día</h3>
            <div id="contenedor-top5-diario">
                <p style="color: var(--color-texto-suave); text-align: center; padding: 15px;">Cargando gráfico de barras...</p>
            </div>
        </div>
    `;

                    // 1. Producto Estrella General (Histórico)
                    fetch('https://la-micho-heladeria-backend.onrender.com/api/Ventas/ProductoMasVendido')
                        .then(res => res.json())
                        .then(data => {
                            const contenedor = document.getElementById('contenedor-producto-general');
                            const prod = data.producto;
                            if (!prod) {
                                contenedor.innerHTML = '<p style="color: var(--color-texto-suave); text-align: center; padding: 15px;">Sin registros.</p>';
                                return;
                            }
                            contenedor.innerHTML = `
                <div style="background: var(--color-fondo); padding: 18px; border-radius: 8px; border: 1px solid var(--color-borde);">
                    <h4 style="margin: 0 0 6px 0; color: var(--color-texto); font-size: 1.1rem;">${escaparHTML(prod.nombre)}</h4>
                    <p style="margin: 0 0 10px 0; color: var(--color-texto-suave); font-size: 0.9rem;">Categoría: ${escaparHTML(prod.categoria || 'General')}</p>
                    <p style="margin: 0; font-weight: bold; color: var(--color-exito); font-size: 1rem;">Total histórico: ${data.totalUnidadesVendidas} unidades</p>
                </div>
            `;
                        })
                        .catch(() => {
                            document.getElementById('contenedor-producto-general').innerHTML = '<p style="color: var(--color-peligro); text-align: center; padding: 15px;">Sin datos suficientes.</p>';
                        });

                    // 2. Producto Estrella Diario y Top 5 por fecha
                    function cargarEstrellaDiario(fechaStr = '') {
                        let url = 'https://la-micho-heladeria-backend.onrender.com/api/Ventas/ProductoMasVendidoDiario';
                        if (fechaStr) {
                            url += `?fecha=${fechaStr}`;
                        }

                        // Cargar el producto número 1 del día
                        fetch(url)
                            .then(res => {
                                if (!res.ok) throw new Error('Sin ventas');
                                return res.json();
                            })
                            .then(data => {
                                const contenedor = document.getElementById('contenedor-producto-diario');
                                const prod = data.producto;
                                contenedor.innerHTML = `
                    <div style="background: var(--color-fondo); padding: 18px; border-radius: 8px; border: 1px solid var(--color-borde);">
                        <h4 style="margin: 0 0 6px 0; color: var(--color-texto); font-size: 1.1rem;">${escaparHTML(prod.nombre)}</h4>
                        <p style="margin: 0 0 10px 0; color: var(--color-texto-suave); font-size: 0.9rem;">Fecha consultada: ${escaparHTML(data.fechaConsulta)}</p>
                        <p style="margin: 0; font-weight: bold; color: var(--color-primario-texto); font-size: 1rem;">Vendidos hoy: ${data.totalUnidadesVendidas} unidades</p>
                    </div>
                `;
                            })
                            .catch(() => {
                                document.getElementById('contenedor-producto-diario').innerHTML = '<p style="color: var(--color-advertencia-texto); font-size: 0.9rem; text-align: center; padding: 15px;">No hay ventas registradas en esta fecha.</p>';
                            });

                        // Cargar el Top 5 de productos del día en formato de barras
                        // (el backend no tiene endpoint de Top 5: se calcula en el cliente con las ventas de ese día)
                        fetch(`https://la-micho-heladeria-backend.onrender.com/api/Ventas/PorFecha?fecha=${fechaStr}`)
                            .then(res => res.json())
                            .then(ventas => {
                                const contenedorTop5 = document.getElementById('contenedor-top5-diario');

                                if (!ventas || ventas.length === 0) {
                                    contenedorTop5.innerHTML = '<p style="color: var(--color-texto-suave); text-align: center; padding: 15px;">No hay datos de ventas para graficar el Top 5 en esta fecha.</p>';
                                    return;
                                }

                                // Agrupamos unidades vendidas por producto
                                let productosMap = {};
                                ventas.forEach(v => {
                                    if (v.detalleVenta) {
                                        v.detalleVenta.forEach(det => {
                                            const nombreProd = det.idProductoNavigation ? det.idProductoNavigation.nombre : `Producto #${det.idProducto}`;
                                            if (!productosMap[nombreProd]) {
                                                productosMap[nombreProd] = 0;
                                            }
                                            productosMap[nombreProd] += det.cantidad;
                                        });
                                    }
                                });

                                // Convertimos a array y ordenamos de mayor a menor, tomando el Top 5
                                let arrayProductos = Object.keys(productosMap).map(nombre => ({
                                    nombre: nombre,
                                    cantidad: productosMap[nombre]
                                })).sort((a, b) => b.cantidad - a.cantidad).slice(0, 5);

                                if (arrayProductos.length === 0) {
                                    contenedorTop5.innerHTML = '<p style="color: var(--color-texto-suave); text-align: center; padding: 15px;">Sin productos vendidos hoy.</p>';
                                    return;
                                }

                                const maxUnidades = arrayProductos[0].cantidad || 1; // Para calcular el porcentaje de la barra

                                let barrasHTML = '<div style="display: flex; flex-direction: column; gap: 14px;">';
                                arrayProductos.forEach((p, index) => {
                                    const porcentaje = Math.round((p.cantidad / maxUnidades) * 100);

                                    barrasHTML += `
                        <div style="background: var(--color-fondo); padding: 12px 15px; border-radius: 8px; border: 1px solid var(--color-borde);">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; font-size: 0.95rem;">
                                <span style="font-weight: 600; color: var(--color-texto);"><span style="color: var(--color-primario-texto); margin-right: 6px;">#${index + 1}</span> ${escaparHTML(p.nombre)}</span>
                                <span style="font-weight: bold; color: var(--color-exito);">${p.cantidad} unidades</span>
                            </div>
                            <div style="width: 100%; background: var(--color-secundario-suave); border-radius: 4px; height: 10px; overflow: hidden;">
                                <div style="width: ${porcentaje}%; background: linear-gradient(90deg, var(--color-primario), var(--color-acento)); height: 100%; border-radius: 4px; transition: width 0.4s ease;"></div>
                            </div>
                        </div>
                    `;
                                });
                                barrasHTML += '</div>';

                                contenedorTop5.innerHTML = barrasHTML;
                            })
                            .catch(() => {
                                document.getElementById('contenedor-top5-diario').innerHTML = '<p style="color: var(--color-peligro); text-align: center; padding: 15px;">Error al calcular el Top 5 de productos.</p>';
                            });
                    }

                    setTimeout(() => {

                        if (miRender !== contadorRender) return; // Se dibujó otra sección: no enlazar dos veces
                        const inputFecha = document.getElementById('filtro-fecha-estrella');
                        const fechaLocal = new Date().toLocaleDateString('en-CA');
                        inputFecha.value = fechaLocal;

                        cargarEstrellaDiario(fechaLocal);

                        document.getElementById('btn-consultar-dia').addEventListener('click', () => {
                            cargarEstrellaDiario(inputFecha.value);
                        });
                    }, 100);
                    break;
            }
        });
    });

    // ==========================================
    // CARGA INICIAL (también tras F5): se abre la última sección visitada, o Inicio, y así se
    // ejecutan sus peticiones (productos, clientes, POS, ventas...) en lugar de dejar la pantalla
    // con el mensaje estático de bienvenida.
    // ==========================================
    const enlaceVisible = (seccion) => Array.from(navLinks).find(a =>
        a.getAttribute('data-section') === seccion && a.parentElement.style.display !== 'none');
    const enlaceInicial = enlaceVisible(Sesion.seccionGuardada()) || enlaceVisible('Inicio');
    if (enlaceInicial) {
        enlaceInicial.click();
    }
});
