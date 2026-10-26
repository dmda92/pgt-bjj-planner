export function onlinePresentation(status: string, pending: boolean, blocked: boolean, unsaved: boolean) {
    if (status !== 'Actualizado') return {text: status, success: false};
    if (blocked) return {text: 'Actualización de planes pendiente; revisa el aviso del plan', success: false};
    if (pending) return {text: 'Borrador sin confirmar en el servidor', success: false};
    if (unsaved) return {text: 'Cambios en el perfil sin guardar', success: false};
    return {text: 'Actualizado', success: true};
}
