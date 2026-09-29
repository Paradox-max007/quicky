#!/usr/bin/env python3
"""
Quicky — launch splash generator (from the Quicky logo)

Regenerates every splash asset as: Quicky logo centered on a flat
#0F0F14 background — the same color as the app background, the splash
plugin config (capacitor.config.ts -> backgroundColor) and the icon
gradient's dark end. No more white flash before the dark app loads.

  Android (window background + @capacitor/splash-screen resource):
    res/drawable*/splash.png   — same buckets/sizes as the Capacitor
                                 template, logo = 50% of min dimension
  iOS (Splash imageset used by LaunchScreen.storyboard):
    Splash.imageset/splash-2732x2732*.png — square, same composition

Run from the repo root:  python3 scripts/gen-splash.py
"""
import os
from PIL import Image

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOGO_PATH = os.path.join(REPO, 'public', 'quicky-logo.png')
RES = os.path.join(REPO, 'android', 'app', 'src', 'main', 'res')
IOS_SPLASH_DIR = os.path.join(
    REPO, 'ios', 'App', 'App', 'Assets.xcassets', 'Splash.imageset')

BG = (0x0F, 0x0F, 0x14)      # app background / splash config color
LOGO_FRAC = 0.50              # logo width = 50% of the canvas min dimension

ANDROID_BUCKETS = {
    'drawable': (480, 320),
    'drawable-land-mdpi': (480, 320),
    'drawable-land-hdpi': (800, 480),
    'drawable-land-xhdpi': (1280, 720),
    'drawable-land-xxhdpi': (1600, 960),
    'drawable-land-xxxhdpi': (1920, 1280),
    'drawable-port-mdpi': (320, 480),
    'drawable-port-hdpi': (480, 800),
    'drawable-port-xhdpi': (720, 1280),
    'drawable-port-xxhdpi': (960, 1600),
    'drawable-port-xxxhdpi': (1280, 1920),
}

IOS_SIZES = {
    'splash-2732x2732.png': 2732,
    'splash-2732x2732-1.png': 2732,
    'splash-2732x2732-2.png': 2732,
}


def load_logo() -> Image.Image:
    logo = Image.open(LOGO_PATH).convert('RGBA')
    bbox = logo.getbbox()
    if bbox:
        logo = logo.crop(bbox)
    return logo


def compose(w: int, h: int, logo: Image.Image) -> Image.Image:
    """Flat #0F0F14 canvas + logo centered at LOGO_FRAC of min dimension."""
    canvas = Image.new('RGB', (w, h), BG)
    target_w = round(min(w, h) * LOGO_FRAC)
    scale = target_w / logo.width
    l = logo.resize((target_w, max(1, round(logo.height * scale))), Image.LANCZOS)
    canvas.paste(l, ((w - l.width) // 2, (h - l.height) // 2), l)
    return canvas


def main() -> None:
    logo = load_logo()
    print(f'logo: {logo.width}x{logo.height}')

    for bucket, (w, h) in ANDROID_BUCKETS.items():
        path = os.path.join(RES, bucket, 'splash.png')
        compose(w, h, logo).save(path, optimize=True)
        print(f'  {os.path.relpath(path, REPO)}  {w}x{h}')

    for name, size in IOS_SIZES.items():
        path = os.path.join(IOS_SPLASH_DIR, name)
        compose(size, size, logo).save(path, optimize=True)
        print(f'  {os.path.relpath(path, REPO)}  {size}x{size}')
    print('done.')


if __name__ == '__main__':
    main()
