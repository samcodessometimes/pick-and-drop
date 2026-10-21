#!/usr/bin/env python3
"""Generates the original illustrations in images/ (meals, groceries, covers, fallbacks).

These are drawn by code, so they are original artwork with no third party licence.
They are placeholders for real photographs, not photographs. See images/README.md.

Run from the project root:  python3 tools/make_illustrations.py
"""
import os, random

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'images')
RED, CORAL, SCARLET, GOLD, LIME, OLIVE, DEEP, CREAM = '#AC3229', '#BE5247', '#E34A3D', '#DCB56B', '#C1A94C', '#948D3C', '#655C20', '#F9F3E2'
W, H = 800, 600


def svg(body, bg, title, desc):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" role="img" aria-labelledby="t d">'
            f'<title id="t">{title}</title><desc id="d">{desc}</desc>'
            f'<rect width="{W}" height="{H}" fill="{bg}"/><circle cx="650" cy="90" r="190" fill="#fff" opacity=".35"/>'
            f'<circle cx="90" cy="540" r="150" fill="#fff" opacity=".25"/>{body}</svg>')


def write(folder, name, content):
    path = os.path.join(ROOT, folder, name + '.svg')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w') as f:
        f.write(content)


def plate(cx=400, cy=330):
    return (f'<ellipse cx="{cx}" cy="{cy + 150}" rx="300" ry="38" fill="#000" opacity=".12"/>'
            f'<ellipse cx="{cx}" cy="{cy}" rx="290" ry="200" fill="#fff" stroke="#e8dfc8" stroke-width="8"/>'
            f'<ellipse cx="{cx}" cy="{cy}" rx="235" ry="155" fill="#f7f0df" stroke="#eadfc4" stroke-width="3"/>')


def grains(cx, cy, rx, ry, n, color, seed):
    rnd = random.Random(seed)
    out = []
    for _ in range(n):
        a, r = rnd.random() * 6.283, rnd.random() ** .5
        x, y = cx + rx * r * __import__('math').cos(a), cy + ry * r * __import__('math').sin(a)
        out.append(f'<ellipse cx="{x:.0f}" cy="{y:.0f}" rx="7" ry="3.2" fill="{color}" transform="rotate({rnd.randint(0, 180)} {x:.0f} {y:.0f})"/>')
    return ''.join(out)


def rice(cx, cy, color, grain, seed, rx=130, ry=85):
    return (f'<path d="M{cx - rx} {cy + 30} Q{cx - rx + 10} {cy - ry} {cx} {cy - ry - 10} Q{cx + rx - 10} {cy - ry} {cx + rx} {cy + 30} '
            f'Q{cx} {cy + 70} {cx - rx} {cy + 30}Z" fill="{color}"/>' + grains(cx, cy - 5, rx - 25, ry - 25, 70, grain, seed))


def drumstick(x, y, rot=0, color='#9a4b1f'):
    return (f'<g transform="translate({x} {y}) rotate({rot})"><rect x="48" y="-9" width="70" height="18" rx="9" fill="#f4ead0"/>'
            f'<circle cx="122" cy="-9" r="9" fill="#f4ead0"/><circle cx="122" cy="9" r="9" fill="#f4ead0"/>'
            f'<ellipse cx="0" cy="0" rx="62" ry="42" fill="{color}"/><ellipse cx="-12" cy="-12" rx="34" ry="14" fill="#c4743a" opacity=".7"/></g>')


def slice_circle(cx, cy, r, color):
    return f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{color}"/>'


def tomato_slice(cx, cy):
    return (f'<circle cx="{cx}" cy="{cy}" r="26" fill="{SCARLET}"/><circle cx="{cx}" cy="{cy}" r="19" fill="#f08a7e"/>'
            f'<path d="M{cx} {cy - 17}V{cy + 17}M{cx - 17} {cy}H{cx + 17}" stroke="{SCARLET}" stroke-width="3"/>')


def jollof():
    b = plate() + rice(330, 330, '#d9572b', '#f2a46a', 1)
    b += drumstick(520, 340, -20) + slice_circle(560, 250, 0, 'none')
    b += ''.join(f'<ellipse cx="{x}" cy="{y}" rx="26" ry="16" fill="{GOLD}" stroke="#b98b3a" stroke-width="3"/>' for x, y in [(250, 440), (310, 458), (370, 448)])
    b += tomato_slice(560, 235) + f'<path d="M468 225c20-20 50-20 60 0-20 14-45 14-60 0z" fill="{OLIVE}"/>'
    return svg(b, '#fbe9d6', 'Jollof rice with chicken', 'Illustration of a plate of jollof rice with a fried chicken drumstick and fried plantain')


def fried_fish_rice():
    b = plate() + rice(300, 340, '#fffaf0', '#e8dfc8', 2)
    b += (f'<g transform="translate(520 330) rotate(-12)"><path d="M-110 0Q-40 -75 60 -40Q110 -20 130 -50L130 50Q110 20 60 40Q-40 75 -110 0Z" fill="#d89a3c"/>'
          f'<path d="M-60 -35Q0 -55 40 -30M-60 35Q0 55 40 30" stroke="#a96d1c" stroke-width="5" fill="none"/>'
          f'<path d="M-30 -10H60M-30 10H60" stroke="#a96d1c" stroke-width="4" opacity=".6"/><circle cx="-78" cy="-8" r="7" fill="#3b2a1a"/></g>')
    b += f'<path d="M455 450l45-20 20 38z" fill="{LIME}"/><circle cx="560" cy="440" r="22" fill="{SCARLET}" opacity=".9"/>'
    b += f'<ellipse cx="330" cy="455" rx="48" ry="16" fill="#c43b25" opacity=".9"/>'
    return svg(b, '#fdf1d5', 'Fried fish and rice', 'Illustration of white rice with a whole fried fish, a lime wedge and pepper sauce')


def bowl(cx, cy, color, rim='#fff'):
    return (f'<ellipse cx="{cx}" cy="{cy + 130}" rx="230" ry="30" fill="#000" opacity=".12"/>'
            f'<path d="M{cx - 220} {cy - 20}H{cx + 220}Q{cx + 210} {cy + 140} {cx} {cy + 150}Q{cx - 210} {cy + 140} {cx - 220} {cy - 20}Z" fill="{rim}" stroke="#e8dfc8" stroke-width="6"/>'
            f'<ellipse cx="{cx}" cy="{cy - 20}" rx="220" ry="58" fill="{rim}" stroke="#e8dfc8" stroke-width="6"/>'
            f'<ellipse cx="{cx}" cy="{cy - 20}" rx="196" ry="46" fill="{color}"/>')


def fufu_soup():
    b = bowl(400, 330, '#c8641e')
    b += (f'<ellipse cx="400" cy="300" rx="85" ry="62" fill="#fff8e8" stroke="#eadfc4" stroke-width="4"/><ellipse cx="380" cy="282" rx="38" ry="20" fill="#fff" opacity=".7"/>'
          + ''.join(f'<circle cx="{x}" cy="{y}" r="9" fill="#e8a24b"/>' for x, y in [(260, 320), (300, 345), (500, 340), (545, 318), (330, 365), (470, 362)])
          + f'<rect x="560" y="200" width="16" height="170" rx="8" fill="#b98b3a" transform="rotate(25 568 285)"/>')
    return svg(b, '#fbe6cf', 'Fufu with groundnut soup', 'Illustration of a bowl of groundnut soup with a ball of fufu')


def cassava_rice():
    b = plate() + rice(290, 340, '#fffaf0', '#e8dfc8', 3, 120, 80)
    b += (f'<path d="M420 300Q450 230 540 250Q620 270 600 350Q585 430 500 440Q410 440 420 300Z" fill="#2f5d1f"/>'
          + ''.join(f'<ellipse cx="{x}" cy="{y}" rx="30" ry="10" fill="#4f8a35" transform="rotate({r} {x} {y})"/>' for x, y, r in [(470, 300, 20), (530, 330, -30), (500, 390, 10), (560, 380, -10)])
          + ''.join(f'<circle cx="{x}" cy="{y}" r="8" fill="#b6471c"/>' for x, y in [(480, 350), (540, 290), (520, 410)]))
    return svg(b, '#e9efd7', 'Cassava leaves with rice', 'Illustration of rice served with cassava leaf stew')


def burger(crispy=False):
    patty = '#c58a2b' if crispy else '#5a2f1a'
    b = '<ellipse cx="300" cy="500" rx="210" ry="26" fill="#000" opacity=".12"/>'
    b += '<path d="M120 300Q130 130 300 120Q470 130 480 300Z" fill="#d98b2f"/><ellipse cx="230" cy="190" rx="38" ry="16" fill="#f1c885" opacity=".7"/>'
    b += ''.join(f'<ellipse cx="{x}" cy="{y}" rx="9" ry="4" fill="#fff3d6"/>' for x, y in [(210, 170), (300, 150), (380, 180), (260, 225), (350, 235)])
    b += f'<path d="M105 300Q140 330 180 305Q220 335 260 305Q300 335 340 305Q380 335 420 305Q455 330 495 300V325H105Z" fill="{OLIVE}"/>'
    b += f'<rect x="115" y="320" width="370" height="20" fill="#e5322d"/><path d="M110 340H490L470 365H130Z" fill="{GOLD}"/>'
    b += f'<rect x="120" y="360" width="360" height="52" rx="24" fill="{patty}"/>'
    if crispy:
        b += ''.join(f'<circle cx="{x}" cy="386" r="5" fill="#e0a947"/>' for x in range(150, 460, 34))
    b += '<path d="M115 412H485Q480 470 300 475Q120 470 115 412Z" fill="#d98b2f"/>'
    c = ('<path d="M560 330L575 500H695L710 330Z" fill="%s"/>' % RED
         + ''.join(f'<rect x="{x}" y="{y}" width="20" height="150" rx="6" fill="#f0c34a" transform="rotate({r} {x} {y})"/>' for x, y, r in [(585, 220, -12), (610, 200, -4), (635, 205, 3), (660, 215, 10), (687, 235, 15)])
         + '<path d="M556 330L572 500H698L714 330Z" fill="%s"/><rect x="590" y="395" width="90" height="34" rx="6" fill="#fff" opacity=".85"/>' % RED)
    name = 'Chicken burger and chips' if crispy else 'Burger and chips'
    return svg(b + c, '#fde9e1', name, f'Illustration of a {name.lower()}')


def pizza(pepperoni):
    b = '<ellipse cx="400" cy="500" rx="300" ry="30" fill="#000" opacity=".12"/>'
    b += '<circle cx="400" cy="300" r="250" fill="#d99a49"/><circle cx="400" cy="300" r="224" fill="#c33a24"/><circle cx="400" cy="300" r="212" fill="#f3c969"/>'
    rnd = random.Random(7)
    spots = [(rnd.random() * 6.283, rnd.random() ** .5 * 175) for _ in range(9)]
    import math
    for a, r in spots:
        x, y = 400 + r * math.cos(a), 300 + r * math.sin(a)
        if pepperoni:
            b += f'<circle cx="{x:.0f}" cy="{y:.0f}" r="30" fill="#a82a1f"/><circle cx="{x - 8:.0f}" cy="{y - 8:.0f}" r="6" fill="#d9574a"/>'
        else:
            b += f'<ellipse cx="{x:.0f}" cy="{y:.0f}" rx="34" ry="24" fill="#fff6dc"/><path d="M{x - 8:.0f} {y:.0f}q10-26 28-10-8 22-28 10z" fill="#3f7d2a"/>'
    b += ''.join(f'<path d="M400 300L{400 + 224 * math.cos(a):.0f} {300 + 224 * math.sin(a):.0f}" stroke="#c9902f" stroke-width="4" opacity=".8"/>' for a in [i * math.pi / 4 for i in range(8)])
    name = 'Pepperoni pizza' if pepperoni else 'Margherita pizza'
    return svg(b, '#fbe3d0', name, f'Illustration of a {name.lower()}')


def grilled_chicken():
    b = plate() + drumstick(300, 330, -10, '#8a3f17') + drumstick(330, 420, 14, '#8a3f17')
    b += ''.join(f'<path d="M{x} {y}l40 -18" stroke="#3b1e0c" stroke-width="7" stroke-linecap="round" opacity=".7"/>' for x, y in [(260, 315), (280, 340), (300, 365)])
    b += ''.join(f'<rect x="{x}" y="{y}" width="18" height="110" rx="6" fill="#f0c34a" transform="rotate({r} {x} {y})"/>' for x, y, r in [(520, 270, -30), (548, 262, -18), (575, 262, -6), (602, 268, 8), (628, 280, 20)])
    b += tomato_slice(560, 450)
    return svg(b, '#f9e4cf', 'Grilled chicken and chips', 'Illustration of grilled chicken pieces with chips and a tomato slice')


def chips():
    b = '<ellipse cx="400" cy="520" rx="230" ry="28" fill="#000" opacity=".12"/>'
    b += ''.join(f'<rect x="{x}" y="{y}" width="26" height="250" rx="8" fill="#f0c34a" stroke="#d9a62c" stroke-width="3" transform="rotate({r} {x} {y})"/>' for x, y, r in
                 [(250, 190, -22), (300, 160, -14), (350, 140, -6), (400, 130, 0), (450, 140, 7), (500, 160, 14), (548, 190, 22), (330, 180, -4), (470, 185, 5)])
    b += f'<path d="M230 330L262 520H538L570 330Z" fill="{RED}"/><rect x="310" y="395" width="180" height="48" rx="8" fill="#fff" opacity=".85"/>'
    return svg(b, '#fdebd0', 'Chips', 'Illustration of a carton of chips')


def drinks_meal():
    b = '<ellipse cx="400" cy="520" rx="260" ry="28" fill="#000" opacity=".12"/>'
    b += f'<path d="M300 180H500L480 500Q400 520 320 500Z" fill="#fff" opacity=".9" stroke="#e8dfc8" stroke-width="6"/><path d="M308 260H492L478 495Q400 512 322 495Z" fill="{SCARLET}"/>'
    b += '<rect x="420" y="90" width="14" height="190" rx="7" fill="#fff" stroke="#e8dfc8" stroke-width="3" transform="rotate(14 427 185)"/>'
    b += ''.join(f'<circle cx="{x}" cy="{y}" r="9" fill="#fff" opacity=".6"/>' for x, y in [(360, 330), (420, 380), (380, 440), (450, 310)])
    return svg(b, '#fde0d8', 'Soft drink', 'Illustration of a tall glass of red soft drink with a straw')


MEALS = {'jollof-rice-chicken': jollof, 'fried-fish-rice': fried_fish_rice, 'fufu-groundnut-soup': fufu_soup,
         'cassava-leaves-rice': cassava_rice, 'burger-chips': lambda: burger(False), 'chicken-burger-chips': lambda: burger(True),
         'pizza-margherita': lambda: pizza(False), 'pizza-pepperoni': lambda: pizza(True), 'grilled-chicken-chips': grilled_chicken,
         'chips': chips, 'soft-drink': drinks_meal}

# ---------------- groceries ----------------

def shelf_bg(body, bg, title, desc):
    return svg('<ellipse cx="400" cy="500" rx="280" ry="30" fill="#000" opacity=".12"/>' + body, bg, title, desc)


def tomatoes():
    b = ''.join(f'<circle cx="{x}" cy="{y}" r="{r}" fill="{SCARLET}"/><ellipse cx="{x - r // 3}" cy="{y - r // 3}" rx="{r // 3}" ry="{r // 5}" fill="#fff" opacity=".35"/>'
                f'<path d="M{x - 18} {y - r + 4}l18 14 18-14-10 22h-16z" fill="{OLIVE}"/>' for x, y, r in [(300, 400, 85), (470, 410, 90), (385, 300, 85), (540, 290, 70), (250, 280, 66)])
    return shelf_bg(b, '#fbe0da', 'Fresh tomatoes', 'Illustration of a pile of fresh tomatoes')


def onions():
    b = ''.join(f'<path d="M{x} {y - r - 40}Q{x + 10} {y - r} {x + r} {y}Q{x + r} {y + r} {x} {y + r}Q{x - r} {y + r} {x - r} {y}Q{x - 10} {y - r} {x} {y - r - 40}Z" fill="#c98aa0"/>'
                f'<path d="M{x} {y - r}V{y + r}M{x - r // 2} {y - r // 2}Q{x - r // 2 + 6} {y + r // 2} {x - 8} {y + r}M{x + r // 2} {y - r // 2}Q{x + r // 2 - 6} {y + r // 2} {x + 8} {y + r}" stroke="#a96681" stroke-width="4" fill="none"/>'
                for x, y, r in [(290, 390, 90), (480, 400, 95), (385, 285, 85)])
    return shelf_bg(b, '#f1e3ea', 'Onions', 'Illustration of purple onions')


def bananas():
    b = ''.join(f'<path d="M{150 + i * 30} 200Q{250 + i * 30} 420 {560 + i * 18} {420 + i * 14}Q{600 + i * 18} {440 + i * 14} {590 + i * 18} {392 + i * 14}Q{330 + i * 30} 360 {190 + i * 30} 170Z" fill="{"#f1d24a" if i % 2 else "#ecc72f"}" stroke="#b99410" stroke-width="4"/>' for i in range(4))
    b += '<rect x="130" y="150" width="70" height="50" rx="12" fill="#6e5a1a" transform="rotate(-12 165 175)"/>'
    return shelf_bg(b, '#fdf3cc', 'Bananas', 'Illustration of a bunch of ripe bananas')


def oranges():
    b = ''.join(f'<circle cx="{x}" cy="{y}" r="{r}" fill="#f08a1c"/><circle cx="{x - r // 3}" cy="{y - r // 3}" r="{r // 4}" fill="#fff" opacity=".28"/><circle cx="{x}" cy="{y - r + 6}" r="7" fill="{DEEP}"/>' for x, y, r in [(300, 400, 88), (480, 410, 92), (390, 295, 86), (560, 300, 66)])
    b += f'<path d="M390 205c40-50 100-40 110 0-40 24-85 26-110 0z" fill="{OLIVE}"/>'
    return shelf_bg(b, '#fde5c6', 'Oranges', 'Illustration of fresh oranges with a leaf')


def cabbage():
    b = ''.join(f'<ellipse cx="{x}" cy="{y}" rx="{rx}" ry="{ry}" fill="{c}"/>' for x, y, rx, ry, c in
                [(400, 330, 210, 190, '#7aa84a'), (400, 335, 170, 150, '#98c062'), (400, 340, 120, 108, '#b6d680'), (400, 345, 66, 60, '#d3e9a6')])
    b += '<path d="M400 160V500M330 190Q320 330 350 480M470 190Q480 330 450 480" stroke="#6a9440" stroke-width="5" fill="none" opacity=".7"/>'
    return shelf_bg(b, '#e8f1d8', 'Cabbage', 'Illustration of a green cabbage')


def peppers():
    b = ''.join(f'<g transform="translate({x} {y}) rotate({r})"><path d="M0 0Q70 40 60 170Q40 230 10 240Q30 150 -30 60Q-20 10 0 0Z" fill="{c}"/><path d="M-8 6Q0 -26 24 -34" stroke="{OLIVE}" stroke-width="12" fill="none" stroke-linecap="round"/></g>'
                for x, y, r, c in [(300, 220, -8, '#d5301f'), (400, 200, 6, '#e5471f'), (500, 230, 14, '#c52a1a'), (350, 260, -20, '#f0592b')])
    return shelf_bg(b, '#fadbd2', 'Hot peppers', 'Illustration of red hot peppers')


def rice_bag():
    b = ('<path d="M240 140Q400 100 560 140L580 500Q400 530 220 500Z" fill="#f4ead0" stroke="#d6c79e" stroke-width="6"/>'
         '<path d="M240 140Q400 180 560 140" fill="none" stroke="#d6c79e" stroke-width="6"/>'
         f'<rect x="290" y="250" width="220" height="150" rx="14" fill="{RED}"/>'
         '<text x="400" y="345" text-anchor="middle" font-family="Georgia,serif" font-size="64" font-weight="700" fill="#fff">RICE</text>'
         f'<text x="400" y="385" text-anchor="middle" font-family="sans-serif" font-size="24" fill="{CREAM}">5 kg</text>'
         + grains(400, 440, 120, 20, 22, '#e6d9b2', 11))
    return shelf_bg(b, '#f7efd9', 'Bag of rice', 'Illustration of a 5 kilogram bag of rice')


def oil_bottle():
    b = (f'<rect x="350" y="90" width="100" height="70" rx="12" fill="{RED}"/><path d="M330 160H470L520 260V490Q520 520 490 520H310Q280 520 280 490V260Z" fill="#f2c94c" stroke="#c9a02a" stroke-width="6"/>'
         '<path d="M300 300H500V460Q500 495 470 495H330Q300 495 300 460Z" fill="#e5a928"/>'
         f'<rect x="320" y="330" width="160" height="100" rx="10" fill="#fff" opacity=".9"/><text x="400" y="392" text-anchor="middle" font-family="sans-serif" font-size="40" font-weight="700" fill="{RED}">OIL</text>'
         '<path d="M440 190l60 70" stroke="#fff" stroke-width="10" opacity=".4" stroke-linecap="round"/>')
    return shelf_bg(b, '#fcf0c4', 'Cooking oil', 'Illustration of a bottle of cooking oil')


def water_bottle():
    b = ('<rect x="365" y="90" width="70" height="46" rx="10" fill="#2f79b5"/><path d="M350 136H450Q470 190 470 230V500Q470 520 450 520H350Q330 520 330 500V230Q330 190 350 136Z" fill="#cfe9f7" stroke="#8cc4e3" stroke-width="6"/>'
         '<path d="M330 330H470V500Q470 520 450 520H350Q330 520 330 500Z" fill="#8cc4e3" opacity=".6"/><rect x="330" y="260" width="140" height="70" fill="#2f79b5"/>'
         '<text x="400" y="308" text-anchor="middle" font-family="sans-serif" font-size="30" font-weight="700" fill="#fff">WATER</text>'
         '<path d="M360 160v120" stroke="#fff" stroke-width="10" opacity=".6" stroke-linecap="round"/>')
    return shelf_bg(b, '#e0f1fa', 'Bottled water', 'Illustration of a bottle of drinking water')


def juice():
    b = (f'<path d="M290 160L400 110 510 160V500Q400 530 290 500Z" fill="#fff" stroke="#e8dfc8" stroke-width="6"/><path d="M290 160L400 200 510 160" fill="none" stroke="#e8dfc8" stroke-width="6"/>'
         '<path d="M290 220H510V500Q400 530 290 500Z" fill="#f08a1c"/><circle cx="400" cy="350" r="70" fill="#f9b24a"/><circle cx="400" cy="350" r="52" fill="#f08a1c"/>'
         f'<path d="M400 300V400M350 350H450M365 315L435 385M435 315L365 385" stroke="#f9b24a" stroke-width="4"/><path d="M400 250c30-34 70-30 78-2-30 18-60 18-78 2z" fill="{OLIVE}"/>')
    return shelf_bg(b, '#fde5c6', 'Juice carton', 'Illustration of an orange juice carton')


def soap():
    b = ''.join(f'<rect x="{x}" y="{y}" width="250" height="140" rx="40" fill="{c}" transform="rotate({r} {x + 125} {y + 70})"/><rect x="{x + 40}" y="{y + 45}" width="170" height="50" rx="14" fill="#fff" opacity=".5" transform="rotate({r} {x + 125} {y + 70})"/>'
                for x, y, r, c in [(150, 330, -8, '#6fb7c9'), (360, 290, 6, '#e8a0b0'), (260, 160, -4, '#a9d36d')])
    b += ''.join(f'<circle cx="{x}" cy="{y}" r="{r}" fill="#fff" stroke="#bfe3ee" stroke-width="3" opacity=".8"/>' for x, y, r in [(580, 200, 34), (630, 270, 22), (560, 300, 16), (650, 160, 14)])
    return shelf_bg(b, '#e3f1f4', 'Bars of soap', 'Illustration of three bars of soap with bubbles')


def toothpaste():
    b = ('<g transform="rotate(-18 400 300)"><path d="M180 250H520L600 275V325L520 350H180Q150 300 180 250Z" fill="#fff" stroke="#d8d8d8" stroke-width="6"/>'
         f'<rect x="230" y="262" width="260" height="76" fill="{RED}"/><text x="360" y="312" text-anchor="middle" font-family="sans-serif" font-size="34" font-weight="700" fill="#fff">MINT</text>'
         '<rect x="600" y="268" width="62" height="64" rx="10" fill="#2f79b5"/></g>'
         '<g transform="rotate(14 420 470)"><rect x="240" y="450" width="340" height="30" rx="14" fill="#2f79b5"/><rect x="560" y="430" width="90" height="70" rx="12" fill="#6fb7c9"/>'
         + ''.join(f'<rect x="{x}" y="410" width="10" height="36" rx="4" fill="#fff"/>' for x in range(572, 646, 14)) + '</g>')
    return shelf_bg(b, '#e3f1f4', 'Toothpaste and toothbrush', 'Illustration of a tube of toothpaste and a toothbrush')


def detergent():
    b = ('<rect x="300" y="100" width="110" height="60" rx="12" fill="#e5322d"/><path d="M290 160H520Q560 200 560 260V490Q560 520 530 520H290Q260 520 260 490V260Q260 200 290 160Z" fill="#4aa3df" stroke="#2f79b5" stroke-width="6"/>'
         '<path d="M430 160H520Q560 200 560 260V330Q500 300 430 330Z" fill="#fff" opacity=".18"/><rect x="290" y="300" width="240" height="130" rx="14" fill="#fff" opacity=".92"/>'
         f'<text x="410" y="372" text-anchor="middle" font-family="sans-serif" font-size="38" font-weight="700" fill="#2f79b5">WASH</text><text x="410" y="408" text-anchor="middle" font-family="sans-serif" font-size="20" fill="{DEEP}">Laundry liquid</text>'
         '<path d="M580 130Q640 130 640 190V300" fill="none" stroke="#2f79b5" stroke-width="22" stroke-linecap="round"/>')
    return shelf_bg(b, '#e3f1f4', 'Laundry detergent', 'Illustration of a bottle of laundry liquid')


def tissue():
    b = ''.join(f'<ellipse cx="{x}" cy="{y}" rx="115" ry="45" fill="#fff" stroke="#e0e0e0" stroke-width="5"/><rect x="{x - 115}" y="{y}" width="230" height="135" fill="#fff" stroke="#e0e0e0" stroke-width="5"/>'
                f'<ellipse cx="{x}" cy="{y + 135}" rx="115" ry="45" fill="#f4f4f4" stroke="#e0e0e0" stroke-width="5"/><ellipse cx="{x}" cy="{y}" rx="38" ry="15" fill="#d9d2c0"/>' for x, y in [(290, 270), (500, 270), (395, 340)])
    return shelf_bg(b, '#efeaf5', 'Toilet tissue', 'Illustration of rolls of toilet tissue')


GROCERY = {'fresh-tomatoes': tomatoes, 'onions': onions, 'bananas': bananas, 'oranges': oranges, 'cabbage': cabbage, 'hot-peppers': peppers,
           'rice-5kg': rice_bag, 'cooking-oil': oil_bottle, 'bottled-water': water_bottle, 'juice-carton': juice,
           'soap-bars': soap, 'toothpaste': toothpaste, 'laundry-liquid': detergent, 'toilet-tissue': tissue}

# ---------------- covers ----------------

def storefront(awning1, awning2, sign, inside, bg, title, desc, produce=False):
    b = f'<rect x="0" y="470" width="{W}" height="130" fill="#d9ccb0"/><rect x="90" y="190" width="620" height="290" fill="#fff" stroke="#e0d3b6" stroke-width="6"/>'
    b += f'<rect x="130" y="270" width="540" height="210" fill="{inside}" opacity=".9"/>'
    stripes = ''.join(f'<path d="M{90 + i * 62} 140h62v70q-31 36-62 0z" fill="{awning1 if i % 2 == 0 else awning2}"/>' for i in range(10))
    b += stripes + f'<rect x="90" y="120" width="620" height="30" rx="6" fill="{sign}"/>'
    if produce:
        b += ''.join(f'<rect x="{150 + i * 130}" y="400" width="110" height="70" rx="8" fill="#b88a4a"/>' + ''.join(f'<circle cx="{170 + i * 130 + j * 26}" cy="398" r="17" fill="{c}"/>' for j in range(4) for c in [["#e5471f", "#f08a1c", "#7aa84a", "#f1d24a"][i % 4]]) for i in range(4))
        b += ''.join(f'<rect x="{150 + i * 135}" y="300" width="100" height="14" fill="#a0814a"/><rect x="{160 + i * 135}" y="270" width="26" height="30" rx="4" fill="{["#2f79b5", "#e5322d", "#f2c94c", "#4aa3df"][i % 4]}"/><rect x="{196 + i * 135}" y="270" width="26" height="30" rx="4" fill="{["#f2c94c", "#4aa3df", "#e5322d", "#2f79b5"][i % 4]}"/>' for i in range(4))
    else:
        b += '<ellipse cx="400" cy="420" rx="170" ry="26" fill="#fff"/><ellipse cx="400" cy="408" rx="120" ry="18" fill="#d9572b"/><circle cx="350" cy="396" r="22" fill="#9a4b1f"/><circle cx="450" cy="398" r="22" fill="#9a4b1f"/>'
        b += f'<circle cx="200" cy="340" r="28" fill="{GOLD}"/><circle cx="600" cy="340" r="28" fill="{GOLD}"/><path d="M370 300l30-34 30 34z" fill="{SCARLET}"/>'
    b += '<rect x="360" y="330" width="80" height="150" fill="#fff" opacity=".0"/>'
    return svg(b, bg, title, desc)


COVERS = {
    'restaurant-kitchen': lambda: storefront(RED, CREAM, DEEP, '#f3d9b0', '#fbe9d6', 'Restaurant illustration', 'Illustration of a restaurant front with a striped awning'),
    'restaurant-grill': lambda: storefront(DEEP, GOLD, RED, '#f0cf9c', '#f9e4cf', 'Grill restaurant illustration', 'Illustration of a grill restaurant front'),
    'restaurant-fastfood': lambda: storefront(SCARLET, '#fff', DEEP, '#f6dcc9', '#fde9e1', 'Fast food illustration', 'Illustration of a fast food shop front'),
    'grocery-market': lambda: storefront(OLIVE, CREAM, DEEP, '#e6efd2', '#eef3dd', 'Fresh market illustration', 'Illustration of a fresh produce market stall', True),
    'grocery-supermarket': lambda: storefront(RED, GOLD, DEEP, '#f3ebd2', '#f7efd9', 'Supermarket illustration', 'Illustration of a supermarket front with shelves', True),
}


def fallback(name, label, accent):
    b = (f'<rect x="250" y="170" width="300" height="260" rx="30" fill="#fff" opacity=".8"/><circle cx="400" cy="270" r="62" fill="{accent}"/>'
         f'<path d="M370 270h60M400 240v60" stroke="#fff" stroke-width="12" stroke-linecap="round"/>'
         f'<text x="400" y="385" text-anchor="middle" font-family="sans-serif" font-size="24" font-weight="700" fill="{DEEP}">{label}</text>')
    return svg(b, CREAM, label, 'Placeholder shown when an image is not available')


def main():
    for k, f in MEALS.items():
        write('meals', k, f())
    for k, f in GROCERY.items():
        write('groceries', k, f())
    for k, f in COVERS.items():
        write('covers', k, f())
    write('fallback', 'meal', fallback('meal', 'Meal photo coming soon', RED))
    write('fallback', 'product', fallback('product', 'Photo coming soon', OLIVE))
    write('fallback', 'store', fallback('store', 'Store photo coming soon', GOLD))
    print('wrote', len(MEALS) + len(GROCERY) + len(COVERS) + 3, 'images')


if __name__ == '__main__':
    main()
