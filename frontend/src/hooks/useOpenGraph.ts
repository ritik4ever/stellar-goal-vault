import { useEffect } from 'react';

interface OgMeta {
  title: string;
  description: string;
  image?: string;
  url?: string;
}

function setMeta(property: string, content: string) {
  const propKey = property.startsWith('og:') ? 'property' : 'name';
  const attr = `[${propKey}="${property}"]`;
  let el = document.head.querySelector<HTMLMetaElement>(attr);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(propKey, property);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function removeMeta(property: string) {
  const propKey = property.startsWith('og:') ? 'property' : 'name';
  const attr = `[${propKey}="${property}"]`;
  const el = document.head.querySelector<HTMLMetaElement>(attr);
  if (el) el.remove();
}

const OG_PROPS = [
  'og:title',
  'og:description',
  'og:image',
  'og:url',
  'og:type',
  'twitter:card',
  'twitter:title',
  'twitter:description',
  'twitter:image',
] as const;

export function useOpenGraph(meta: OgMeta | null) {
  useEffect(() => {
    if (!meta) {
      OG_PROPS.forEach(removeMeta);
      return;
    }

    setMeta('og:title', meta.title);
    setMeta('og:description', meta.description);
    setMeta('og:type', 'website');
    setMeta('twitter:card', 'summary_large_image');
    setMeta('twitter:title', meta.title);
    setMeta('twitter:description', meta.description);

    if (meta.image) {
      setMeta('og:image', meta.image);
      setMeta('twitter:image', meta.image);
    } else {
      removeMeta('og:image');
      removeMeta('twitter:image');
    }

    if (meta.url) {
      setMeta('og:url', meta.url);
    }

    return () => {
      OG_PROPS.forEach(removeMeta);
    };
  }, [meta]);
}
