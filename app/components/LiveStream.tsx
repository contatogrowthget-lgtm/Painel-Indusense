"use client";

import { useEffect, useRef, useState } from "react";

/** Vídeo MJPEG que reconecta sozinho quando o sistema de câmera cai e volta. */
export default function LiveStream({
  src, alt, className, onState,
}: { src: string; alt: string; className?: string; onState?: (ok: boolean) => void }) {
  const [url, setUrl] = useState(src);
  const [ok, setOk] = useState(true);
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setUrl(src);
    setOk(true);
  }, [src]);

  useEffect(() => () => { if (retry.current) clearTimeout(retry.current); }, []);

  useEffect(() => { onState?.(ok); }, [ok, onState]);

  return (
    <img
      src={url}
      alt={alt}
      className={className}
      onLoad={() => setOk(true)}
      onError={() => {
        setOk(false);
        if (retry.current) clearTimeout(retry.current);
        retry.current = setTimeout(() => {
          const sep = src.includes("?") ? "&" : "?";
          setUrl(`${src}${sep}t=${Date.now()}`);
        }, 3000);
      }}
    />
  );
}
