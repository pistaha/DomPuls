/* Official MAX Bridge is loaded only for a MAX launch, not for an ordinary local visit. */
window.DomPulseLaunch = (async function () {
  const params = new URLSearchParams(location.hash.slice(1));
  const keys = [...params.keys()];
  if (new Set(keys).size !== keys.length) return {error:'Повторяющиеся параметры запуска. Откройте приложение заново из MAX.'};
  const maxLaunch = params.has('WebAppData') || !!window.WebApp?.initData;
  if (!maxLaunch) return {initData:''};
  document.body.classList.add('embedded');
  let loaded = !!window.WebApp;
  if (!loaded) loaded = await new Promise(resolve => {
    const script=document.createElement('script');
    const timeout=setTimeout(()=>resolve(false),4000);
    script.src='https://st.max.ru/js/max-web-app.js';
    script.onload=()=>{clearTimeout(timeout);resolve(true);};
    script.onerror=()=>{clearTimeout(timeout);resolve(false);};
    document.head.appendChild(script);
  });
  // This string is only passed to server validation; initDataUnsafe is never trusted.
  return {initData:window.WebApp?.initData || params.get('WebAppData') || '',bridgeLoaded:loaded};
})();
