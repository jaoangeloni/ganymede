import { useState } from "react";
import { srcOf } from "../lib/images";
import type { Reference } from "../types";

const previewWidth = (reference: Reference) => (reference.source === "bing" ? 474 : 640);

export const needsSharp = (reference: Reference, pixels: number) => pixels > previewWidth(reference) * 1.2;

interface Props {
  reference: Reference;
  sharp: boolean;
  alt?: string;
  onLoad?(): void;
  onError?(): void;
}

export function Picture({ reference, sharp, alt = "", onLoad, onError }: Props) {
  const [upgraded, setUpgraded] = useState(false);
  const large = srcOf(reference.imageUrl);
  return (
    <>
      <img
        src={srcOf(reference.thumbUrl)}
        alt={alt}
        draggable={false}
        decoding="async"
        referrerPolicy="no-referrer"
        onLoad={onLoad}
        onError={onError}
        className="size-full object-cover"
      />
      {sharp && large && reference.imageUrl !== reference.thumbUrl && (
        <img
          src={large}
          alt=""
          draggable={false}
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={() => setUpgraded(true)}
          className={`pointer-events-none absolute inset-0 size-full object-cover transition-opacity duration-300 ${upgraded ? "opacity-100" : "opacity-0"}`}
        />
      )}
    </>
  );
}
