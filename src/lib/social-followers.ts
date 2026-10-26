import type { SocialDay } from './social-totals';
import type { Period } from './dashboard-periods';
import { dayNumber, isoFromDay, todayISO } from './dashboard-periods';
export type ManualFollower = {platform:string;day:string;total_followers:number|null;net_growth:number|null;new_followers:number|null};
export function mergeFollowerHistory(days:SocialDay[],manual:ManualFollower[]):SocialDay[] {
  const rows=new Map(days.map(d=>[`${d.platform}:${d.source}:${d.day}`,{...d,metrics:{...d.metrics}}]));
  for(const m of manual){
    const source=({instagram:'instagram',tiktok:'tiktok_organic',linkedin:'linkedin_organic',facebook:'facebook_organic'} as Record<string,string>)[m.platform];
    if(!source)continue;
    const key=`${m.platform}:${source}:${m.day}`;
    const row=rows.get(key)??{platform:m.platform,source,day:m.day,metrics:{},followers_estimated:false};
    if(m.total_followers!=null&&(row.metrics['followers']==null||row.followers_estimated)){row.metrics['followers']=m.total_followers;row.followers_estimated=false;}
    const growth=m.platform==='tiktok'?m.net_growth:m.new_followers;
    if(row.metrics['newFollowers']==null&&growth!=null)row.metrics['newFollowers']=growth;
    rows.set(key,row);
  }
  return [...rows.values()];
}
const followerSource=(platform:string)=>platform==='facebook'?'facebook_organic':platform==='linkedin'?'linkedin_organic':platform==='tiktok'?'tiktok_organic':'instagram';
export function followerAt(days:SocialDay[],platform:string,end:string){
  const source=followerSource(platform);
  return days.filter(d=>d.platform===platform&&d.source===source&&d.day<=end&&d.metrics['followers']!=null).sort((a,b)=>b.day.localeCompare(a.day))[0];
}
export function followerChange(days:SocialDay[],platform:string,period:Period){
  const start=followerAt(days,platform,isoFromDay(dayNumber(period.start)-1))?.metrics['followers']??null;
  const end=followerAt(days,platform,period.end)?.metrics['followers']??null;
  return {start,end,value:start==null||end==null?null:end-start,percent:start==null||end==null||start===0?null:(end-start)/start*100};
}
/** Pas du graphe d'audience : « day » seulement sous 14 jours (aucun bouton), sinon la vue Semaine, Mois ou Année. */
export type AudienceStep='day'|'week'|'month'|'year';
export type AudienceView='week'|'month'|'year';
export const AUDIENCE_VIEW_LABELS:Record<AudienceView,string>={week:'Semaine',month:'Mois',year:'Année'};
/** Durée minimale de la période (en jours) pour proposer une vue : 3 semaines = Semaine seule, 3 mois = Semaine et Mois, un an = pas encore Année (un seul point annuel ne dit rien). */
export const AUDIENCE_MIN_DAYS:Record<AudienceView,number>={week:14,month:60,year:730};
/** Au-delà, la vue par défaut passe au pas suivant pour rester lisible. */
export const AUDIENCE_MAX_POINTS=30;
const audienceEnd=(period:Period,today:string)=>period.end<today?period.end:today;
/** Vues proposées (boutons) pour la période du sélecteur, la fin plafonnée à aujourd'hui. */
export function audienceViews(period:Period,today=todayISO()):AudienceView[]{
  const end=audienceEnd(period,today),n=end<period.start?0:dayNumber(end)-dayNumber(period.start)+1;
  return(['week','month','year'] as const).filter(v=>n>=AUDIENCE_MIN_DAYS[v]);
}
/** Vue par défaut : la plus fine qui reste lisible (30 points au plus), sinon la plus large disponible ; un point par jour sous 14 jours. */
export function audienceDefaultView(period:Period,today=todayISO()):AudienceStep{
  const views=audienceViews(period,today);
  return views.find(v=>audienceDates(period,today,v).length<=AUDIENCE_MAX_POINTS)??views[views.length-1]??'day';
}
export type AudiencePoint={date:string;label:string;full:string;followers:number|null;estimated:boolean};
/** Dates des points : toujours le début et la fin de la période (la fin plafonnée à aujourd'hui, jamais une date future), les points intermédiaires selon le pas (semaine : tous les 7 jours depuis le début ; mois et année : chaque fin de mois ou d'année). */
export function audienceDates(period:Period,today=todayISO(),step:AudienceStep=audienceDefaultView(period,today)):string[]{
  const start=period.start,end=audienceEnd(period,today);
  if(end<start)return[];
  const dates=[start];
  if(step==='day')for(let i=dayNumber(start)+1;i<=dayNumber(end);i++)dates.push(isoFromDay(i));
  else if(step==='week'){for(let i=dayNumber(start)+7;i<=dayNumber(end);i+=7)dates.push(isoFromDay(i));if(dates[dates.length-1]!==end)dates.push(end);}
  else{
    const first=new Date(`${start}T00:00:00Z`);
    for(let k=0;;k++){
      const boundary=step==='month'?new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+k+1,0)):new Date(Date.UTC(first.getUTCFullYear()+k+1,0,0));
      const iso=boundary.toISOString().slice(0,10);
      if(iso>=end)break;
      if(iso>start)dates.push(iso);
    }
    if(end>start)dates.push(end);
    // Vue Mois : un point est un mois (« mai 25 ») ; le début, s'il tombe dans le même mois que la première fin de mois, est son doublon et s'efface.
    if(step==='month'&&dates.length>2&&dates[0]!.slice(0,7)===dates[1]!.slice(0,7))dates.shift();
  }
  return dates;
}
/** Évolution de l'audience sur les dates du sélecteur : à chaque point, la dernière valeur connue à cette date ou avant (sans zéro inventé : avant le premier relevé, le point est vide). Une valeur estimée est signalée. */
export function audienceSeries(days:SocialDay[],platform:string,period:Period,today=todayISO(),step:AudienceStep=audienceDefaultView(period,today)):AudiencePoint[]{
  const dates=audienceDates(period,today,step);
  const source=followerSource(platform);
  const rows=days.filter(d=>d.platform===platform&&d.source===source&&d.metrics['followers']!=null).sort((a,b)=>a.day.localeCompare(b.day));
  const crossesYears=period.start.slice(0,4)!==dates[dates.length-1]?.slice(0,4);
  const withYear=step==='year'||crossesYears;
  // Vue Mois : « mai 25 », sans jour. Les autres vues gardent la date (« 19 oct. », « 31 déc. 25 »).
  const short=(iso:string)=>new Date(`${iso}T00:00:00Z`).toLocaleDateString('fr-FR',step==='month'?{month:'short',year:'2-digit',timeZone:'UTC'}:{day:'numeric',month:'short',...(withYear?{year:'2-digit' as const}:{}),timeZone:'UTC'});
  let i=0,last:SocialDay|undefined;
  return dates.map(date=>{
    while(i<rows.length&&rows[i]!.day<=date)last=rows[i++];
    return{date,label:short(date),full:new Date(`${date}T00:00:00Z`).toLocaleDateString('fr-FR',{timeZone:'UTC'}),followers:last?.metrics['followers']??null,estimated:last?.followers_estimated??false};
  });
}
