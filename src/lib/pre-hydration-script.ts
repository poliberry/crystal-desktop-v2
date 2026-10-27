/**
 * Runs in `<head>` before the page is drawn, so the first frame already wears the person's theme.
 *
 * `ThemeProvider` and `AccessibilityProvider` read localStorage in effects, which run after the first paint: the window was
 * drawn once in the stylesheet's default (light) palette, then re-styled in full when the effect injected the real one. On a
 * machine that draws in software that is a visible flash and a whole-tree style recalculation at the worst moment of the
 * launch. This does the same work a frame earlier, from the same keys, in the same shape, so the providers find
 * what they would have made and replace it with an identical copy.
 *
 * It is a string rather than a module because it has to run before any module does. Everything is wrapped in try/catch: if
 * storage is unavailable or a value is damaged, the page simply starts the way it always did and the providers take over.
 *
 * What it can't do is the `system` and `dynamic` modes' palette, which comes from the preset table and the OS accent colour,
 * both of which are in the bundle. For those it only gets the light/dark class right (which is most of the flash) and the
 * provider supplies the colours.
 *
 * Keep the keys and the stylesheet text in step with `theme-provider.tsx` and `accessibility-provider.tsx`.
 */
export const PRE_HYDRATION_SCRIPT = `(function(){try{
var d=document.documentElement,ls=window.localStorage;
var mode=ls.getItem("crystal-theme-mode");
var dark=true;
if(mode==="system"||mode==="dynamic"){
  dark=window.matchMedia("(prefers-color-scheme: dark)").matches;
}else{
  var raw=ls.getItem("crystal-theme");
  if(raw){
    var t=JSON.parse(raw);
    if(t&&typeof t==="object"&&t.colors&&typeof t.colors==="object"){
      var vars="";
      for(var k in t.colors){
        if(Object.prototype.hasOwnProperty.call(t.colors,k))vars+="  --"+k+": "+t.colors[k]+";\\n";
      }
      var font=t.font?"\\n  --font-sans: "+t.font+";":"";
      var el=document.createElement("style");
      el.id="crystal-theme-vars";
      el.setAttribute("data-prehydrate","");
      // "html:root" and "html.dark" out-rank the stylesheet's ":root" and ".dark", so this wins wherever the bundler put
      // that stylesheet relative to this element. ThemeProvider replaces the element with its ordinary one straight after.
      el.textContent="html:root {\\n"+vars+font+"\\n}\\nhtml.dark {\\n"+vars+font+"\\n}";
      document.head.appendChild(el);
      dark=t.isDark!==false;
    }
  }
}
d.classList.toggle("dark",dark);
var a=ls.getItem("crystal-accessibility");
if(a){
  var p=JSON.parse(a);
  if(p&&typeof p==="object"){
    d.classList.toggle("a11y-reduced-motion",p.reducedMotion===true);
    d.classList.toggle("a11y-reduce-blur",p.reduceBlur===true);
    d.classList.toggle("a11y-high-contrast",p.highContrast===true);
    d.classList.toggle("a11y-readable-font",p.readableFont===true);
    d.classList.toggle("a11y-underline-links",p.underlineLinks===true);
    if(typeof p.textScale==="number"&&p.textScale>0&&p.textScale<4)d.style.setProperty("--a11y-text-scale",String(p.textScale));
  }
}
}catch(e){}})();`;
