'use client';
import { useEffect } from 'react';
import Script from 'next/script';
import { usePathname } from 'next/navigation';
import { pluginMap } from '../core/store.js';
import type { Store } from '../core/types.js';
import { PIXEL_ID_RE, dlPush } from '../client/index.js';
import { useBlanxer } from './context.js';

const safeId = (v: unknown) => String(v ?? '').replace(/[^A-Za-z0-9_-]/g, '');

/**
 * Marketing tags from the store's plugins: Meta Pixel (`fb_pixel`), Google
 * Analytics 4 (`ga`), Google Tag Manager (`gtm`) and Microsoft Clarity
 * (`clarity`). Loads after hydration.
 *
 * The Meta pixel fires PageView once on load; later route changes are counted
 * by the pixel itself (it tracks history changes). It is skipped when GTM or
 * pasted code already set up the same pixel id. Every route change also
 * pushes `bx_page_view` to GTM's dataLayer.
 */
export function Pixel({ store: storeProp }: { store?: Store }) {
  const ctx = useBlanxer();
  const store = storeProp || ctx.store;
  const plugins = pluginMap(store);
  const fbRaw = String(plugins.get('fb_pixel') ?? '').trim();
  const fb = PIXEL_ID_RE.test(fbRaw) ? fbRaw : '';
  const ga = safeId(plugins.get('ga'));
  const gtm = safeId(plugins.get('gtm'));
  const clarity = safeId(plugins.get('clarity'));
  const pathname = usePathname();

  useEffect(() => {
    dlPush({ event: 'bx_page_view', page_path: pathname });
  }, [pathname]);

  // `fb` is digits only, so it is safe inside the inline script.
  const init = `var s=fbq.getState&&fbq.getState();var q=fbq.queue||[];var dup=(s&&s.pixels||[]).some(function(p){return String(p.id)==='${fb}'})||q.some(function(a){return a&&a[0]==='init'&&String(a[1])==='${fb}'});if(dup){console.warn('Meta pixel ${fb} is installed twice (GTM or custom code too); using that one.')}else{fbq('init','${fb}');fbq('track','PageView');}`;

  return (
    <>
      {fb ? (
        <Script id="bx-facebook-pixel" strategy="afterInteractive">
          {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');${init}`}
        </Script>
      ) : null}
      {ga ? (
        <>
          <Script id="bx-ga-src" strategy="afterInteractive" src={`https://www.googletagmanager.com/gtag/js?id=${ga}`} />
          <Script id="bx-ga" strategy="afterInteractive">
            {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${ga}');`}
          </Script>
        </>
      ) : null}
      {gtm ? (
        <Script id="bx-gtm" strategy="afterInteractive">
          {`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${gtm}');`}
        </Script>
      ) : null}
      {clarity ? (
        <Script id="bx-clarity" strategy="lazyOnload">
          {`(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script","${clarity}");`}
        </Script>
      ) : null}
    </>
  );
}
