#!/usr/bin/env python3
"""
Quicky — Android/iOS app icon generator (from the Quicky logo)

Regenerates every launcher icon from public/quicky-logo.png:

  Android adaptive icons (API 26+):
    res/mipmap-*/ic_launcher_foreground.png   logo inside the safe-zone circle
    res/mipmap-*/ic_launcher_background.png   brand gradient (108dp layers)
    res/mipmap-*/ic_launcher_monochrome.png   white silhouette (themed icons)
  Android legacy (API < 26):
    res/mipmap-*/ic_launcher.png               rounded-square, gradient + logo
    res/mipmap-*/ic_launcher_round.png         circle, gradient + logo
  iOS:
    ios/.../AppIcon.appiconset/AppIcon-512@2x.png   1024x1024 opaque

Brand composition: diagonal gradient #1A1A2E -> #0F0F14 (the app's two
background colors) with the coral Quicky emblem centered — matches the
splash/status-bar color (#0F0F14) already configured in capacitor.config.ts.

Run from the repo root:  python3 scripts/gen-app-icons.py
"""
import os
import numpy as np
from PIL import Image, ImageDraw

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOGO_PATH = os.path.join(REPO, 'public', 'quicky-logo.png')
RES = os.path.join(REPO, 'android', 'app', 'src', 'main', 'res')
IOS_ICON = os.path.join(
    REPO, 'ios', 'App', 'App', 'Assets.xcassets', 'AppIcon.appiconset',
    'AppIcon-512@2x.png')

# Brand colors (README § Visual identity)
GRAD_TOP_LEFT = (0x1A, 0x1A, 0x2E)   # deep indigo
GRAD_BOTTOM_RIGHT = (0x0F, 0x0F, 0x14)  # near-black (app background)

SS = 4  # supersampling factor for crisp edges

DENSITIES = [('mdpi', 1), ('hdpi', 1.5), ('xhdpi', 2), ('xxhdpi', 3), ('xxxhdpi', 4)]
ADAPTIVE_DP = 108   # adaptive icon layer size
LEGACY_DP = 48      # legacy launcher icon size
SAFE_DIAG_DP = 68    # logo diagonal within the 108dp layer (66=guaranteed safe zone)
LEGACY_LOGO_W = 0.62  # logo width fraction on legacy/iOS canvases
IOS_SIZE = 1024


def load_logo() -> Image.Image:
    logo = Image.open(LOGO_PATH).convert('RGBA')
    bbox = logo.getbbox()
    if bbox:
        logo = logo.crop(bbox)
    return logo


def gradient(w: int, h: int) -> Image.Image:
    """Diagonal brand gradient, computed directly at final size (no edges)."""
    c1 = np.array(GRAD_TOP_LEFT, dtype=np.float32)
    c2 = np.array(GRAD_BOTTOM_RIGHT, dtype=np.float32)
    xx, yy = np.meshgrid(np.linspace(0.0, 1.0, w), np.linspace(0.0, 1.0, h))
    t = ((xx + yy) / 2.0)[..., None]
    arr = (c1 * (1 - t) + c2 * t).astype(np.uint8)
    return Image.fromarray(arr)


def paste_centered(canvas_px: int, logo: Image.Image, target_w: int) -> Image.Image:
    """Transparent square canvas with the logo centered at target_w width."""
    scale = target_w / logo.width
    nw = max(1, round(logo.width * scale))
    nh = max(1, round(logo.height * scale))
    l = logo.resize((nw, nh), Image.LANCZOS)
    canvas = Image.new('RGBA', (canvas_px, canvas_px), (0, 0, 0, 0))
    canvas.paste(l, ((canvas_px - nw) // 2, (canvas_px - nh) // 2), l)
    return canvas


def adaptive_foreground(canvas_px: int, logo: Image.Image) -> Image.Image:
    """108dp layer: logo diagonal = SAFE_DIAG_DP, centered (transparent bg)."""
    aspect = logo.width / logo.height
    diag = SAFE_DIAG_DP / ADAPTIVE_DP * canvas_px
    h = diag / (aspect ** 2 + 1) ** 0.5
    w = h * aspect
    big = paste_centered(canvas_px * SS, logo, round(w * SS))
    return big.resize((canvas_px, canvas_px), Image.LANCZOS)


def monochrome_layer(canvas_px: int, logo: Image.Image) -> Image.Image:
    """White silhouette of the logo (Android 13+ themed icons get tinted)."""
    aspect = logo.width / logo.height
    diag = SAFE_DIAG_DP / ADAPTIVE_DP * canvas_px
    h = diag / (aspect ** 2 + 1) ** 0.5
    w = h * aspect
    big = paste_centered(canvas_px * SS, logo, round(w * SS))
    # recolor every opaque pixel to pure white, keep alpha
    arr = np.array(big)
    white = np.zeros_like(arr)
    white[..., 0:3] = 255
    white[..., 3] = arr[..., 3]
    return Image.fromarray(white).resize((canvas_px, canvas_px), Image.LANCZOS)


def adaptive_background(canvas_px: int) -> Image.Image:
    return gradient(canvas_px, canvas_px).convert('RGBA')


def legacy_icon(canvas_px: int, logo: Image.Image, circle: bool) -> Image.Image:
    """Gradient + centered logo, masked to rounded square (or circle)."""
    big = canvas_px * SS
    base = gradient(big, big).convert('RGBA')
    logo_w = round(big * LEGACY_LOGO_W)
    scale = logo_w / logo.width
    l = logo.resize((logo_w, max(1, round(logo.height * scale))), Image.LANCZOS)
    base.paste(l, ((big - l.width) // 2, (big - l.height) // 2), l)

    mask = Image.new('L', (big, big), 0)
    d = ImageDraw.Draw(mask)
    if circle:
        d.ellipse((0, 0, big - 1, big - 1), fill=255)
    else:
        r = round(big * 0.18)
        d.rounded_rectangle((0, 0, big - 1, big - 1), radius=r, fill=255)
    mask = mask.resize((canvas_px, canvas_px), Image.LANCZOS)

    base = base.resize((canvas_px, canvas_px), Image.LANCZOS)
    out = Image.new('RGBA', (canvas_px, canvas_px), (0, 0, 0, 0))
    out.paste(base, (0, 0), mask)
    return out


def ios_icon(size: int, logo: Image.Image) -> Image.Image:
    """Opaque RGB (App Store rejects alpha) — gradient + centered logo."""
    base = gradient(size, size).convert('RGB')
    logo_w = round(size * LEGACY_LOGO_W)
    scale = logo_w / logo.width
    l = logo.resize((logo_w, max(1, round(logo.height * scale))), Image.LANCZOS)
    base.paste(l, ((size - l.width) // 2, (size - l.height) // 2), l)
    return base


def main() -> None:
    logo = load_logo()
    print(f'logo: {logo.width}x{logo.height}')

    for density, mult in DENSITIES:
        d = os.path.join(RES, f'mipmap-{density}')
        adaptive_px = round(ADAPTIVE_DP * mult)
        legacy_px = round(LEGACY_DP * mult)

        jobs = [
            ('ic_launcher_foreground.png', adaptive_foreground(adaptive_px, logo)),
            ('ic_launcher_background.png', adaptive_background(adaptive_px)),
            ('ic_launcher_monochrome.png', monochrome_layer(adaptive_px, logo)),
            ('ic_launcher.png', legacy_icon(legacy_px, logo, circle=False)),
            ('ic_launcher_round.png', legacy_icon(legacy_px, logo, circle=True)),
        ]
        for name, img in jobs:
            path = os.path.join(d, name)
            img.save(path, optimize=True)
            print(f'  {os.path.relpath(path, REPO)}  {img.width}x{img.height}')

    os.makedirs(os.path.dirname(IOS_ICON), exist_ok=True)
    ios_icon(IOS_SIZE, logo).save(IOS_ICON, optimize=True)
    print(f'  {os.path.relpath(IOS_ICON, REPO)}  {IOS_SIZE}x{IOS_SIZE}')
    print('done.')


if __name__ == '__main__':
    main()
