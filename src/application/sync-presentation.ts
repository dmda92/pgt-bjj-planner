/** Never display a success state while durable or optimistic changes remain pending. */
export function syncPresentation(status:string,pending:boolean,blocked=false,unsaved=false) {
  if(status==='Sincronizado') {
    if(unsaved)return {text:'Cambios en el perfil sin guardar',success:false};
    if(blocked)return {text:'Actualización de planes pendiente; revisa el aviso del plan',success:false};
    if(pending)return {text:'Datos pendientes de sincronizar',success:false};
    return {text:status,success:true};
  }
  return {text:status,success:false};
}
