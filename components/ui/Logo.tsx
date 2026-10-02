import Image from "next/image";


// ==========================================
// TEAMSKI LOGO
// ==========================================
//
// The S: two strokes that pass each other, like
// two people's work meeting in the middle. Drawn
// white, since every screen it sits on is dark,
// on a transparent background, and exported at a
// few sizes into public/; the smallest that is
// still sharp on a high density screen is sent.
//
// Black versions (public/logo-black-*.png) are
// there for light backgrounds. The browser tab
// uses app/icon.svg: the S with no background,
// black on a light tab bar and white on a dark
// one. iPhones use app/apple-icon.png, the black S
// on a white square.
//

export default function Logo({
  size = 36,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  const needed = size * 2;

  const src =
    needed <= 64
      ? "/logo-white-64.png"
      : needed <= 128
        ? "/logo-white-128.png"
        : "/logo-white-512.png";

  return (
    <Image
      src={src}
      alt="Teamski"
      width={size}
      height={size}
      priority
      unoptimized
      className={className}
    />
  );
}
