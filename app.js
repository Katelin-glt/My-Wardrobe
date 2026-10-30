const $ = id => document.getElementById(id);
const config = window.WARDROBE_CONFIG || {};
const cloud = !!(config.supabaseUrl && config.supabaseAnonKey && window.supabase);
const client = cloud ? window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey) : null;
let currentUser = null, items = [], pendingPhoto = null;
const localKey = 'wardrobe-v1-items', cityKey = 'wardrobe-v1-city';
const categoryIcon = {'上衣':'👚','外套':'🧥','裤子':'👖','裙装':'👗','鞋子':'👟','配饰':'🧣'};
const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const toast = (s) => alert(s);
function resetPhoto(){pendingPhoto=null;$('photoPreview').src='';$('photoPreview').classList.add('hidden');}
async function initialize(){
  $('homeCity').value = localStorage.getItem(cityKey) || 'Guildford';$('city').value=$('homeCity').value;
  if(cloud){$('setupNotice').classList.add('hidden');const {data}=await client.auth.getUser();currentUser=data.user;client.auth.onAuthStateChange(async (_event,session)=>{currentUser=session?.user||null;await updateAuthUI();});}
  await updateAuthUI();
}
async function updateAuthUI(){ $('auth').classList.toggle('hidden',!cloud||!!currentUser);$('app').classList.toggle('hidden',cloud&&!currentUser);$('logoutBtn').classList.toggle('hidden',!currentUser);$('userLabel').textContent=currentUser?.email||(cloud?'请登录':'本地体验模式');if(!cloud||currentUser)await loadItems();}
async function loadItems(){
  if(cloud){const {data,error}=await client.from('garments').select('*').order('created_at',{ascending:false});if(error){toast('读取衣橱失败：'+error.message);return;}items=data||[];}
  else {try{items=JSON.parse(localStorage.getItem(localKey)||'[]');}catch{items=[];}}
  renderItems();
}
function renderItems(){
 const q=$('search').value.toLowerCase().trim(),cat=$('filterCategory').value,season=$('filterSeason').value;
 const filtered=items.filter(x=>(!cat||x.category===cat)&&(!season||x.season===season)&&(!q||[x.name,x.color,x.tags,x.notes].join(' ').toLowerCase().includes(q)));
 $('count').textContent=items.length+' 件';
 $('garmentGrid').innerHTML=filtered.length?filtered.map(i=>`<article class="garment">${i.photo_url?`<img class="garment-photo" src="${escapeHtml(i.photo_url)}" alt="${escapeHtml(i.name)}" loading="lazy">`:`<div class="garment-photo">${categoryIcon[i.category]||'👕'}</div>`}<div class="garment-body"><div class="garment-name">${escapeHtml(i.name)}</div><div class="garment-meta">${escapeHtml(i.category)} · ${escapeHtml(i.color||'未填颜色')} · 厚度 ${i.thickness}/5<br>${escapeHtml(i.season||'四季')}</div><div class="garment-actions"><button data-edit="${escapeHtml(i.id)}">编辑</button><button data-delete="${escapeHtml(i.id)}">删除</button></div></div></article>`).join(''):'<div class="empty">还没有符合条件的衣服。点击「＋ 添加衣服」上传你的第一件单品吧！</div>';
}
function openItem(i){$('itemForm').reset();resetPhoto();$('itemId').value=i?.id||'';$('dialogHeading').textContent=i?'编辑衣服':'添加衣服';for(const field of ['name','category','color','thickness','season','tags','notes'])if(i&&i[field]!=null)$(field).value=i[field];if(i?.photo_url){$('photoPreview').src=i.photo_url;$('photoPreview').classList.remove('hidden');}$('itemDialog').showModal();}
function makeId(){return globalThis.crypto?.randomUUID?.()||String(Date.now())+Math.random().toString(36).slice(2);}
async function getPhoto(file){if(!file)return null;if(!file.type.startsWith('image/'))throw new Error('请选择图片文件');if(file.size>12*1024*1024)throw new Error('原图不能超过 12MB');
  const bitmap=await createImageBitmap(file);const canvas=document.createElement('canvas');const scale=Math.min(1,1200/Math.max(bitmap.width,bitmap.height));canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();return new Promise(resolve=>canvas.toBlob(blob=>resolve(blob),'image/jpeg',.78));
}
async function storePhoto(file,id,old){const blob=await getPhoto(file);if(!blob)throw new Error('照片处理失败');if(!cloud){const reader=new FileReader();const url=await new Promise((resolve,reject)=>{reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob)});return {url,path:null};}
 const path=`${currentUser.id}/${id}/${Date.now()}.jpg`;
 const {error}=await client.storage.from('garment-images').upload(path,blob,{contentType:'image/jpeg',upsert:false});if(error)throw error;
 const {data,error:signError}=await client.storage.from('garment-images').createSignedUrl(path,60*60*24*365);if(signError)throw signError;
 return {url:data.signedUrl,path};
}
// Signed URLs expire; refresh them on load so old shared links are not required.
async function refreshPhotos(){if(!cloud)return;await Promise.all(items.map(async i=>{if(!i.photo_path)return;const {data}=await client.storage.from('garment-images').createSignedUrl(i.photo_path,3600);if(data)i.photo_url=data.signedUrl;}));renderItems();}
async function saveItem(ev){ev.preventDefault();const id=$('itemId').value||makeId(),existing=items.find(x=>x.id===id);const doc={id,name:$('name').value.trim(),category:$('category').value,color:$('color').value.trim(),thickness:Number($('thickness').value),season:$('season').value,tags:$('tags').value.trim(),notes:$('notes').value.trim(),photo_path:existing?.photo_path||null,photo_url:existing?.photo_url||null};
 try{const photo=$('photo').files[0];if(photo){const image=await storePhoto(photo,id,existing);doc.photo_url=image.url;doc.photo_path=image.path;}
 if(cloud){const payload={...doc,user_id:currentUser.id};delete payload.photo_url;const {error}=await client.from('garments').upsert(payload);if(error)throw error;
  if(photo&&existing?.photo_path)await client.storage.from('garment-images').remove([existing.photo_path]);
  await loadItems();await refreshPhotos();}
 else{items=[doc,...items.filter(x=>x.id!==id)];try{localStorage.setItem(localKey,JSON.stringify(items));}catch{throw new Error('本机图片存储空间已满，请导出备份或连接 Supabase。')}renderItems();}
 $('itemDialog').close();}catch(e){toast('保存失败：'+e.message);}}
async function deleteItem(id){const i=items.find(x=>x.id===id);if(!i||!confirm(`确定删除「${i.name}」吗？`))return;
 try{if(cloud){const {error}=await client.from('garments').delete().eq('id',id);if(error)throw error;if(i.photo_path)await client.storage.from('garment-images').remove([i.photo_path]);await loadItems();}
 else{items=items.filter(x=>x.id!==id);localStorage.setItem(localKey,JSON.stringify(items));renderItems();}}
 catch(e){toast('删除失败：'+e.message);}}
async function auth(mode){const email=$('email').value.trim(),password=$('password').value; if(!email||password.length<6){toast('请填写邮箱和至少 6 位密码');return;}let response=mode==='register'?await client.auth.signUp({email,password}):await client.auth.signInWithPassword({email,password});if(response.error)toast(response.error.message);else if(mode==='register')toast('注册请求已提交。如项目启用邮箱验证，请先查看验证邮件。');}
async function getWeather(){const name=$('city').value.trim();if(!name){toast('请输入城市');return;}$('weatherResult').textContent='正在查询天气…';
 try{const geo=await fetch('https://geocoding-api.open-meteo.com/v1/search?name='+encodeURIComponent(name)+'&count=1&language=zh&format=json').then(r=>r.json());if(!geo.results?.length)throw new Error('找不到该城市');const place=geo.results[0];const params=new URLSearchParams({latitude:place.latitude,longitude:place.longitude,timezone:place.timezone,daily:'temperature_2m_max,temperature_2m_min,precipitation_probability_max',hourly:'apparent_temperature,wind_speed_10m',forecast_days:'1'});const w=await fetch('https://api.open-meteo.com/v1/forecast?'+params).then(r=>r.json());if(w.error)throw new Error(w.reason);const day=w.daily;const h=w.hourly.time.findIndex(x=>x.endsWith('T08:00'));const feel=w.hourly.apparent_temperature[h]??day.temperature_2m_min[0],wind=w.hourly.wind_speed_10m[h]??0,rain=day.precipitation_probability_max?.[0]??0;
 $('weatherResult').innerHTML=`<h2>📍 ${escapeHtml(place.name)} · 今天</h2><p><strong>${day.temperature_2m_min[0]}–${day.temperature_2m_max[0]}°C</strong> · 08:00 体感 ${feel}°C · 降雨概率最高 ${rain}% · 08:00 风速 ${wind} km/h</p><p>${rain>=40?'☂️ 建议带伞或防水外套。':'🌤️ 降雨风险较低，出门仍可留意天气变化。'} ${feel<10?'早晚偏凉，适合分层穿衣。':'注意日间活动和室内温差。'}</p>`;
 recommend(feel,rain); }catch(e){$('weatherResult').textContent='天气查询失败：'+e.message;$('outfitResult').innerHTML='';}}
function recommend(temp,rain){const picks=[{label:'上衣',cats:['上衣']},{label:'外套',cats:['外套']},{label:'下装',cats:['裤子','裙装']},{label:'鞋子',cats:['鞋子']}].map(slot=>{const candidates=items.filter(x=>slot.cats.includes(x.category));const target=temp<6?5:temp<12?4:temp<18?3:temp<24?2:1;const sorted=candidates.sort((a,b)=>Math.abs(Number(a.thickness)-target)-Math.abs(Number(b.thickness)-target));return {...slot,item:sorted[0]};});
 $('outfitResult').innerHTML=picks.map(p=>`<div class="outfit-card">${p.item?.photo_url?`<img src="${escapeHtml(p.item.photo_url)}" alt="${escapeHtml(p.item.name)}">`:`<div class="emoji">${categoryIcon[p.cats[0]]||'👕'}</div>`}<h4>${p.label}</h4><div>${escapeHtml(p.item?.name||'尚未添加该类衣服')}</div><p class="muted">${escapeHtml(p.item?('厚度 '+p.item.thickness+'/5 · '+p.item.color):'请先上传')}</p></div>`).join('');}
function downloadExport(){const blob=new Blob([JSON.stringify({version:1,exportedAt:new Date().toISOString(),items},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='my-wardrobe-backup.json';a.click();URL.revokeObjectURL(url);}
async function importExport(file){if(cloud){toast('云端模式请通过逐件上传维护衣橱，避免导入覆盖其他数据。');return;}try{const obj=JSON.parse(await file.text());if(!Array.isArray(obj.items))throw new Error('文件格式不正确');if(!confirm(`将导入 ${obj.items.length} 件衣服，并覆盖当前本地记录，是否继续？`))return;items=obj.items;localStorage.setItem(localKey,JSON.stringify(items));renderItems();toast('导入完成');}catch(e){toast('导入失败：'+e.message);}}
document.querySelectorAll('.tab').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x===b));for(const name of ['closet','outfit','settings'])$(name+'Tab').classList.toggle('hidden',b.dataset.tab!==name);}));
$('garmentGrid').addEventListener('click',e=>{const edit=e.target.closest('[data-edit]'),del=e.target.closest('[data-delete]');if(edit)openItem(items.find(x=>x.id===edit.dataset.edit));if(del)deleteItem(del.dataset.delete);});
$('addBtn').onclick=()=>openItem();$('itemForm').onsubmit=saveItem;$('closeDialog').onclick=$('cancelDialog').onclick=()=>$('itemDialog').close();$('photo').onchange=async e=>{const file=e.target.files[0];if(file){$('photoPreview').src=URL.createObjectURL(file);$('photoPreview').classList.remove('hidden');}};
$('search').oninput=$('filterCategory').onchange=$('filterSeason').onchange=renderItems;
$('authForm').onsubmit=e=>{e.preventDefault();auth('login')};$('registerBtn').onclick=()=>auth('register');$('logoutBtn').onclick=()=>client?.auth.signOut();$('weatherBtn').onclick=getWeather;$('saveCityBtn').onclick=()=>{localStorage.setItem(cityKey,$('homeCity').value.trim());$('city').value=$('homeCity').value.trim();toast('保存成功')};$('exportBtn').onclick=downloadExport;$('importFile').onchange=e=>{if(e.target.files[0])importExport(e.target.files[0]);};
initialize().then(async()=>{if(cloud&&currentUser)await refreshPhotos();}).catch(e=>toast('初始化失败：'+e.message));
if ('serviceWorker' in navigator) window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
