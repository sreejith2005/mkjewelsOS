// crm-port: replaces next/image for the one static logo. Renders the <img> attributes
// next/image produces for an unoptimized static image (the CSS sizes it); Vite serves the
// same logo file, so there is no image optimizer in the path.
import type { CSSProperties, ImgHTMLAttributes } from "react";

type StaticImage = { src: string; width?: number; height?: number };

type ImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "alt"> & {
  src: string | StaticImage;
  alt: string;
  priority?: boolean;
};

export default function Image({ src, alt, priority = false, width, height, style, ...rest }: ImageProps) {
  const source = typeof src === "string" ? { src } : src;
  // React 18 has no fetchPriority prop; the lowercase DOM attribute is passed through as-is.
  const priorityAttributes = (priority ? { fetchpriority: "high" } : { loading: "lazy" }) as ImgHTMLAttributes<HTMLImageElement>;
  const imageStyle: CSSProperties = { color: "transparent", ...style };
  return (
    <img
      {...rest}
      {...priorityAttributes}
      alt={alt}
      width={width ?? source.width}
      height={height ?? source.height}
      decoding="async"
      data-nimg="1"
      style={imageStyle}
      src={source.src}
    />
  );
}
