// ==========================================
// SESIÓN DEL USUARIO (compartido por login.html e index.html)
// ==========================================
// La API no emite tokens: la "credencial" es el usuario que devuelve /api/Usuarios/Login, guardado
// en localStorage junto con una fecha de vencimiento. La sesión sobrevive a recargas (F5) y pestañas
// nuevas, y vence tras DURACION_MS sin actividad (vencimiento deslizante). El bloqueo por
// inactividad de 5 minutos (app.js) también se recuerda, así que recargar no lo salta.
const Sesion = (() => {
    const CLAVE_USUARIO = 'usuarioLogueado';
    const CLAVE_EXPIRA = 'sesionExpira';
    const CLAVE_BLOQUEADA = 'sesionBloqueada';
    const CLAVE_SECCION = 'seccionActual';
    const DURACION_MS = 8 * 60 * 60 * 1000;     // 8 horas sin actividad
    const RENOVAR_CADA_MS = 60 * 1000;          // como mucho una escritura por minuto

    // localStorage puede lanzar (modo privado, almacenamiento bloqueado): nunca romper la página
    function leer(clave) {
        try { return localStorage.getItem(clave); } catch { return null; }
    }
    function escribir(clave, valor) {
        try { localStorage.setItem(clave, valor); } catch { /* sin almacenamiento */ }
    }
    function borrar(clave) {
        try { localStorage.removeItem(clave); } catch { /* sin almacenamiento */ }
    }

    function cerrar() {
        [CLAVE_USUARIO, CLAVE_EXPIRA, CLAVE_BLOQUEADA, CLAVE_SECCION].forEach(borrar);
    }

    // Usuario de la sesión si existe y no ha vencido; si no, limpia y devuelve null
    function obtener() {
        let usuario = null;
        try { usuario = JSON.parse(leer(CLAVE_USUARIO)); } catch { usuario = null; }
        const expira = Number(leer(CLAVE_EXPIRA));

        const valida = usuario && typeof usuario === 'object' && usuario.email
            && Number.isFinite(expira) && Date.now() < expira;
        if (!valida) {
            cerrar();
            return null;
        }
        return usuario;
    }

    function iniciar(usuario) {
        escribir(CLAVE_USUARIO, JSON.stringify(usuario));
        escribir(CLAVE_EXPIRA, String(Date.now() + DURACION_MS));
        borrar(CLAVE_BLOQUEADA);
        borrar(CLAVE_SECCION);
    }

    // Extiende el vencimiento con la actividad del usuario
    function renovar() {
        const expira = Number(leer(CLAVE_EXPIRA));
        if (!Number.isFinite(expira) || Date.now() >= expira) return;
        const nuevo = Date.now() + DURACION_MS;
        if (nuevo - expira >= RENOVAR_CADA_MS) {
            escribir(CLAVE_EXPIRA, String(nuevo));
        }
    }

    return {
        CLAVE_USUARIO,
        obtener,
        iniciar,
        renovar,
        cerrar,
        estaBloqueada: () => leer(CLAVE_BLOQUEADA) === 'true',
        marcarBloqueada: (bloqueada) => bloqueada ? escribir(CLAVE_BLOQUEADA, 'true') : borrar(CLAVE_BLOQUEADA),
        seccionGuardada: () => leer(CLAVE_SECCION),
        guardarSeccion: (seccion) => escribir(CLAVE_SECCION, seccion),
    };
})();
