import {validDate} from '../domain/models.ts';
export function competitionDateErrors(start:string,end:string) {
  const errors:{start?:string;end?:string}={};
  if(start && !validDate(start))errors.start='Introduce una fecha inicial válida.';
  if(end && !validDate(end))errors.end='Introduce una fecha del torneo válida.';
  if(validDate(start) && validDate(end)) {
    if(end<=start)errors.end='La fecha del torneo debe ser posterior a la fecha inicial.';
    else if((Date.parse(end)-Date.parse(start))/86400000>730)errors.end='El torneo debe estar como máximo 730 días después del inicio.';
  }
  return errors;
}
