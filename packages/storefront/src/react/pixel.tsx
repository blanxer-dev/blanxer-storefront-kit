'use client';
import { useEffect, useRef } from 'react';
import Script from 'next/script';
import { usePathname } from 'next/navigation';
import { pluginMap } from '../core/store.js';
import type { Store } from '../core/types.js';
import { useBlanxer } from './context.js';

const safeId = (v: unknown) => String(v ?? '').replace(/[^A-Za-z0-9_-]/g, '');

/**
 * Marketing tags from the store's plugins: Meta Pixel (`fb_pixel`, with
 * PageView on every route change), Google Analytics 4 (`ga`), Google Tag
 * Manager (`gtm`) and Microsoft Clarity (`clarity`). Loads after hydration.
 */
export function Pixel({ store: storeProp }: { store?: Store }) {
  const ctx = useBlanxer();
  const store = storeProp || ctx.store;
  const plugins = pluginMap(store);
  const fb = safeId(plugins.get('fb_pixel'));
  const ga = safeId(plugins.get('ga'));
  const gtm = safeId(plugins.get('gtm'));
  const clarity = safeId(plugins.get('clarity'));
  const pathname = usePathname();
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (fb && typeof window !== 'undefined' && window.fbq) window.fbq('track', 'PageView');
  }, [pathname, fb]);

  return (
    <>
      {fb ? (
        <Script id="bx-facebook-pixel" strategy="afterInteractive">
          {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${fb}');fbq('track','PageView');`}
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
