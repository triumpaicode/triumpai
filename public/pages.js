/* TRIUMP AI — shared sub-page JS: lightbox + token countdown */
(function(){
  function ready(fn){if(document.readyState!=="loading")fn();else document.addEventListener("DOMContentLoaded",fn);}
  ready(function(){
    /* lightbox */
    var lb=document.getElementById("lb");
    if(!lb){lb=document.createElement("div");lb.id="lb";lb.innerHTML="<img alt=''>";document.body.appendChild(lb);}
    var lbImg=lb.querySelector("img");
    function close(){lb.style.display="none";lbImg.removeAttribute("src");}
    function open(src){lbImg.src=src;lb.style.display="flex";}
    lb.addEventListener("click",close);
    document.addEventListener("keydown",function(e){if(e.key==="Escape")close();});
    document.addEventListener("click",function(e){
      var img=null;
      var card=e.target.closest(".card,.row,.tokwrap,.hero");
      if(e.target.tagName==="IMG") img=e.target;
      else if(card) img=card.querySelector(".thumb img,.rimg img,img[data-lb]");
      if(img&&img.getAttribute("src")&&!img.closest(".brand")){e.preventDefault();open(img.getAttribute("src"));}
    });

    /* token countdown */
    var box=document.getElementById("count");
    if(box){
      var T=Date.parse(window.TRIUMP_LAUNCH||"");
      if(isNaN(T)){box.style.display="none";}
      function p(n){return(n<10?"0":"")+n;}
      function set(id,v){var el=document.getElementById(id);if(el)el.textContent=v;}
      function tick(){
        var diff=T-Date.now();
        if(diff<=0){box.innerHTML='<div style="font-size:30px;font-weight:900;color:#39ff14;letter-spacing:.04em">🚀 LIVE NOW</div>';return;}
        var s=Math.floor(diff/1000);
        set("cd",p(Math.floor(s/86400)));set("ch",p(Math.floor(s%86400/3600)));
        set("cm",p(Math.floor(s%3600/60)));set("cs",p(s%60));
      }
      if(!isNaN(T)){tick();setInterval(tick,1000);}
    }
    /* copy CA ditangani config.js */
  });
}());
