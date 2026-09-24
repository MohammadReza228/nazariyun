const $ = s => document.querySelector(s);
let mode = "login";
let token = localStorage.getItem("nazariyun_token") || "";
let me = null;
let activeChat = null;
let poll = null;

function msg(el, text, ok=false) { el.textContent = text || ""; el.style.color = ok ? "#86efac" : "#fca5a5"; }
async function api(path, options={}) {
  const headers = {"content-type":"application/json", ...(options.headers||{})};
  if (token) headers.authorization = `Bearer ${token}`;
  const r = await fetch(path, {...options, headers});
  const data = await r.json().catch(()=>({}));
  if (!r.ok) throw new Error(data.error || "خطا");
  return data;
}
function showApp() {
  $("#auth").classList.add("hidden"); $("#app").classList.remove("hidden"); $("#logout").classList.remove("hidden");
  $("#myName").textContent = me.display_name || me.username; $("#myUsername").textContent = "@"+me.username;
  $("#myAvatar").textContent = (me.display_name || me.username).slice(0,1).toUpperCase();
  $("#profileName").value = me.display_name || ""; $("#profileBio").value = me.bio || "";
  $("#status").textContent = "آنلاین";
  loadChats(); loadStories();
}
function showAuth() { $("#auth").classList.remove("hidden"); $("#app").classList.add("hidden"); $("#logout").classList.add("hidden"); $("#status").textContent=""; }
async function bootstrap() {
  try {
    if (!token) return showAuth();
    const d = await api("/api/me");
    if (!d.authenticated) throw new Error("expired");
    me = d.user; showApp();
  } catch { token=""; localStorage.removeItem("nazariyun_token"); showAuth(); }
}
document.querySelectorAll(".tab").forEach(b => b.onclick=()=>{
  mode=b.dataset.mode; document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("active",x===b));
  $("#displayWrap").classList.toggle("hidden",mode!=="register"); $("#authSubmit").textContent=mode==="register"?"ثبت‌نام":"ورود";
  $("#password").autocomplete=mode==="register"?"new-password":"current-password";
});
$("#authForm").onsubmit=async e=>{
  e.preventDefault(); msg($("#authMsg"),"در حال اتصال...");
  try {
    const d=await api(mode==="register"?"/api/register":"/api/login",{method:"POST",body:JSON.stringify({
      username:$("#username").value,password:$("#password").value,display_name:$("#display_name").value
    })});
    token=d.token; me=d.user; localStorage.setItem("nazariyun_token",token); msg($("#authMsg"),"ورود موفق بود.",true); showApp();
  } catch(e){msg($("#authMsg"),e.message)}
};
$("#logout").onclick=async()=>{try{await api("/api/logout",{method:"POST"})}catch{} token="";localStorage.removeItem("nazariyun_token");me=null;showAuth()};
let searchTimer;
$("#userSearch").oninput=()=>{
  clearTimeout(searchTimer); searchTimer=setTimeout(async()=>{
    const q=$("#userSearch").value.trim(); if(q.length<2){$("#userResults").innerHTML="";return}
    try{const d=await api("/api/users?q="+encodeURIComponent(q));$("#userResults").innerHTML=(d.users||[]).filter(u=>u.id!==me.id).map(u=>`<div class="userItem" data-id="${u.id}"><b>${esc(u.display_name||u.username)}</b><small>@${esc(u.username)}</small></div>`).join("");
      document.querySelectorAll(".userItem").forEach(x=>x.onclick=()=>startChat(Number(x.dataset.id),x.querySelector("b").textContent));
    }catch(e){$("#userResults").textContent=e.message}
  },300);
};
async function startChat(id,name){try{const d=await api("/api/chats",{method:"POST",body:JSON.stringify({user_id:id})});activeChat=d.chat_id;$("#chatTitle").textContent=name;$("#chatSub").textContent="گفتگوی خصوصی";$("#message").disabled=false;$("#sendBtn").disabled=false;await loadMessages();loadChats()}catch(e){alert(e.message)}}
async function loadChats(){try{const d=await api("/api/chats");$("#chatList").innerHTML=(d.chats||[]).map(c=>`<div class="chatItem" data-id="${c.id}"><b>${esc(c.title||"گفتگوی خصوصی")}</b><small>${esc(c.last_message||"پیام جدیدی نیست")}</small></div>`).join("")}catch{}}
async function loadMessages(){if(!activeChat)return;try{const d=await api(`/api/chats/${activeChat}/messages`);$("#messages").innerHTML=(d.messages||[]).map(m=>`<div class="bubble ${m.sender_id===me.id?"mine":""}"><div>${esc(m.content)}</div><small>${esc(m.display_name||m.username)} · ${new Date(m.created_at*1000).toLocaleTimeString("fa-IR",{hour:"2-digit",minute:"2-digit"})}</small></div>`).join("")||'<div class="empty">هنوز پیامی نیست.</div>';$("#messages").scrollTop=$("#messages").scrollHeight}catch(e){}}
$("#sendForm").onsubmit=async e=>{e.preventDefault();const v=$("#message").value.trim();if(!v||!activeChat)return;$("#message").value="";try{await api(`/api/chats/${activeChat}/messages`,{method:"POST",body:JSON.stringify({content:v})});await loadMessages()}catch(e){alert(e.message)}};
$("#refresh").onclick=()=>{loadChats();loadMessages();loadStories()};
$("#saveProfile").onclick=async()=>{try{const d=await api("/api/profile",{method:"PUT",body:JSON.stringify({display_name:$("#profileName").value,bio:$("#profileBio").value})});me=d.user;showApp();msg($("#profileMsg"),"پروفایل ذخیره شد.",true)}catch(e){msg($("#profileMsg"),e.message)}};
$("#addStory").onclick=async()=>{try{await api("/api/stories",{method:"POST",body:JSON.stringify({media_url:$("#storyUrl").value,caption:$("#storyCaption").value})});$("#storyUrl").value="";$("#storyCaption").value="";msg($("#storyMsg"),"استوری منتشر شد.",true);loadStories()}catch(e){msg($("#storyMsg"),e.message)}};
async function loadStories(){try{const d=await api("/api/stories");$("#stories").innerHTML=(d.stories||[]).map(s=>`<div class="story"><img src="${esc(s.media_url)}" alt=""><div><b>${esc(s.display_name||s.username)}</b><br>${esc(s.caption||"")}</div></div>`).join("")||'<small>هنوز استوری‌ای نیست.</small>'}catch{}}
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
bootstrap();
setInterval(()=>{if(token&&activeChat)loadMessages()},4000);
