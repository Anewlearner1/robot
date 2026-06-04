#!/usr/bin/env python3
"""
Generate stick-figure exercise GIFs for rehabilitation website.
Style: geometric figure (circle head + lines) on warm-beige background.
Canvas: 320x240, 10-14 frames per GIF, 140ms/frame.
"""

from PIL import Image, ImageDraw
import math, os

# ── Design tokens ──────────────────────────────────────────────────
W, H = 320, 240
BG      = (250, 248, 245)   # #FAF8F5 米白
DARK    = (55,  55,  55)    # 人形
ORANGE  = (232, 132, 90)    # #E8845A 強調
GREEN   = (90,  158, 124)   # #5A9E7C
SHADOW  = (200, 195, 190)   # 地板線
LW = 3   # line width
HR = 13  # head radius

# ── Primitives ─────────────────────────────────────────────────────
def frame():
    img = Image.new('RGB', (W, H), BG)
    d   = ImageDraw.Draw(img)
    # ground line
    d.line([(20, 210), (300, 210)], fill=SHADOW, width=2)
    return img, d

def head(d, x, y, c=DARK):
    d.ellipse([x-HR, y-HR, x+HR, y+HR], outline=c, width=LW)

def seg(d, p1, p2, c=DARK, w=LW):
    d.line([p1, p2], fill=c, width=w)

def dot(d, p, r=4, c=ORANGE):
    d.ellipse([p[0]-r, p[1]-r, p[0]+r, p[1]+r], fill=c)

def pt(x, y): return (int(x), int(y))

def lerp(a, b, t): return a + (b - a) * t

def lp(p1, p2, t):
    return pt(lerp(p1[0], p2[0], t), lerp(p1[1], p2[1], t))

def ease(t):
    """ease in-out"""
    return t*t*(3-2*t)

def ping_pong(n_frames):
    """0→1→0 progression"""
    half = n_frames // 2
    fwd  = [ease(i/(half-1)) for i in range(half)]
    return fwd + fwd[::-1]

def save(frames, path, dur=140):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    frames[0].save(path, save_all=True, append_images=frames[1:],
                   optimize=False, loop=0, duration=dur)

# ── Standing figure helper ──────────────────────────────────────────
def standing(d, cx=160, ground=208,
             lean=0,          # torso lean angle (degrees, 0=upright)
             arm_l_angle=200, # left arm angle from vertical (degrees)
             arm_r_angle=340,
             elbow_l_bend=0,  # extra elbow bend (degrees)
             elbow_r_bend=0,
             knee_l_bend=0,   # knee bend (degrees, 0=straight)
             knee_r_bend=0,
             hip_width=18, shoulder_width=22,
             torso_len=55, upper_arm=32, forearm=28,
             thigh=50, shin=48,
             c=DARK):
    lean_r = math.radians(lean)
    # spine
    hips   = pt(cx, ground - 2)
    torso_top = pt(cx + math.sin(lean_r)*torso_len,
                   ground - 2 - math.cos(lean_r)*torso_len)
    neck   = pt(torso_top[0], torso_top[1] - 6)
    hd     = pt(neck[0], neck[1] - HR - 4)

    head(d, hd[0], hd[1], c)
    seg(d, neck, torso_top, c)
    seg(d, torso_top, hips, c)

    # shoulders & hips bars
    sh_l = pt(torso_top[0] - shoulder_width, torso_top[1] + 8)
    sh_r = pt(torso_top[0] + shoulder_width, torso_top[1] + 8)
    seg(d, sh_l, sh_r, c)

    hp_l = pt(hips[0] - hip_width, hips[1])
    hp_r = pt(hips[0] + hip_width, hips[1])
    seg(d, hp_l, hp_r, c)

    def arm(sh, angle_deg, bend_deg, side):
        a1 = math.radians(angle_deg)
        el = pt(sh[0] + math.sin(a1)*upper_arm,
                sh[1] + math.cos(a1)*upper_arm)
        a2 = math.radians(angle_deg + bend_deg * side)
        wr = pt(el[0] + math.sin(a2)*forearm,
                el[1] + math.cos(a2)*forearm)
        seg(d, sh, el, c)
        seg(d, el, wr, c)
        return wr

    arm(sh_l, arm_l_angle, elbow_l_bend, -1)
    arm(sh_r, arm_r_angle, elbow_r_bend,  1)

    def leg(hp, angle_base, bend_deg, side):
        # thigh direction ≈ straight down with optional bend
        a_thigh = math.radians(180 + angle_base)
        kn = pt(hp[0] + math.sin(a_thigh)*thigh,
                hp[1] - math.cos(a_thigh)*thigh)
        a_shin = math.radians(180 + angle_base + bend_deg * side)
        an = pt(kn[0] + math.sin(a_shin)*shin,
                kn[1] - math.cos(a_shin)*shin)
        seg(d, hp, kn, c)
        seg(d, kn, an, c)
        return an

    leg(hp_l, 0, knee_l_bend, -1)
    leg(hp_r, 0, knee_r_bend,  1)

# ── Lying figure helper ─────────────────────────────────────────────
def lying(d, cy=160, cx_head=55,
          torso_len=70, hip_offset=0,
          arm_l_up=0, arm_r_up=0,     # arm raise angle from horizontal
          knee_l_bend=0, knee_r_bend=0,  # degrees
          hip_l_raise=0, hip_r_raise=0,  # leg raise height
          c=DARK):
    """Figure lying on back (head left)"""
    hd  = pt(cx_head, cy)
    neck = pt(cx_head + HR + 4, cy)
    torso_end = pt(neck[0] + torso_len, cy + hip_offset)
    hp_l = pt(torso_end[0] + 8,  cy - 8 + hip_offset)
    hp_r = pt(torso_end[0] + 8,  cy + 8 + hip_offset)

    head(d, hd[0], hd[1], c)
    seg(d, neck, torso_end, c)
    seg(d, hp_l, hp_r, c)

    # arms along body, raised if specified
    sh_l = pt(neck[0] + 20, cy - 10)
    sh_r = pt(neck[0] + 20, cy + 10)

    def arm_lying(sh, raise_angle, side):
        a = math.radians(-90 + raise_angle * side)  # -90=along body
        el = pt(sh[0] + math.cos(a)*28, sh[1] + math.sin(a)*28)
        wr = pt(el[0] + math.cos(a)*24, el[1] + math.sin(a)*24)
        seg(d, sh, el, c)
        seg(d, el, wr, c)

    arm_lying(sh_l, arm_l_up, -1)
    arm_lying(sh_r, arm_r_up,  1)

    # legs horizontal, knee-bend optional
    def leg_lying(hp, raise_h, bend_deg, side):
        kn = pt(hp[0] + 50, hp[1] - raise_h)
        if bend_deg == 0:
            an = pt(kn[0] + 46, kn[1])
        else:
            a = math.radians(-90 + bend_deg)
            an = pt(kn[0] + math.cos(a)*46, kn[1] + math.sin(a)*46)
        seg(d, hp, kn, c)
        seg(d, kn, an, c)

    leg_lying(hp_l, hip_l_raise, knee_l_bend, -1)
    leg_lying(hp_r, hip_r_raise, knee_r_bend,  1)

# ══════════════════════════════════════════════════════════════════
#  EXERCISES
# ══════════════════════════════════════════════════════════════════

OUT = 'public/gifs'

# ─── 下背痛 ─────────────────────────────────────────────────────────

def lower_back_pain_knee_to_chest():
    """抱膝運動: lying, one knee pulls toward chest"""
    frames = []
    for t in ping_pong(14):
        img, d = frame()
        # ground mat
        d.rectangle([30, 200, 290, 212], fill=(220,215,210))
        lying(d, cy=170, cx_head=55,
              knee_r_bend=int(t*80),
              hip_r_raise=int(t*35))
        # arm pulling knee
        if t > 0.1:
            arm_x = 200
            arm_y = 170 - int(t*35) - 15
            seg(d, pt(135, 170), pt(arm_x, arm_y), ORANGE, 3)
        frames.append(img)
    save(frames, f'{OUT}/lower-back-pain-knee-to-chest.gif')

def lower_back_pain_cat_cow():
    """貓牛式: quadruped, spine arches up then sags"""
    frames = []
    for t in ping_pong(14):
        img, d = frame()
        # all-fours base
        bx, by = 160, 170
        arch = int(t * 22)  # positive=cat(arch up), negative=cow(sag)
        # body
        seg(d, pt(bx-55, by), pt(bx+55, by - arch//2), DARK)
        # spine arc (simplified)
        spine_mid = pt(bx, by - arch)
        seg(d, pt(bx-55, by), spine_mid, DARK)
        seg(d, spine_mid, pt(bx+55, by - arch//2), DARK)
        # head
        head_ang = math.radians(-30 + t * 40)  # looks down when cat
        hd = pt(bx+55 + math.cos(head_ang)*18,
                by - arch//2 + math.sin(head_ang)*18)
        head(d, hd[0], hd[1])
        # limbs
        for lx in [bx-45, bx+45]:
            seg(d, pt(lx, by), pt(lx, by+40), DARK)  # front/back legs
        seg(d, pt(bx-55, by), pt(bx-55, by+40), DARK)
        seg(d, pt(bx+50, by - arch//2), pt(bx+50, by - arch//2 + 40), DARK)
        frames.append(img)
    save(frames, f'{OUT}/lower-back-pain-cat-cow.gif')

def lower_back_pain_bird_dog():
    """鳥狗式: quadruped, opposite arm+leg extend"""
    frames = []
    for t in ping_pong(12):
        img, d = frame()
        bx, by = 155, 165
        seg(d, pt(bx-50, by), pt(bx+50, by), DARK)          # body
        head(d, bx+60, by)                                   # head
        # support limbs
        seg(d, pt(bx-40, by), pt(bx-40, by+40), DARK)       # front-L down
        seg(d, pt(bx+40, by), pt(bx+40, by+40), DARK)       # back-R down
        # extending limbs (orange)
        ext = int(t * 45)
        seg(d, pt(bx-40, by), pt(bx-40 - ext, by - int(t*10)), ORANGE, 4) # L arm
        seg(d, pt(bx+40, by), pt(bx+40 + ext, by - int(t*8)),  ORANGE, 4) # R leg
        frames.append(img)
    save(frames, f'{OUT}/lower-back-pain-bird-dog.gif')

def lower_back_pain_pelvic_tilt():
    """骨盆後傾: lying knees bent, pelvis tilts"""
    frames = []
    for t in ping_pong(12):
        img, d = frame()
        d.rectangle([30, 202, 290, 212], fill=(220,215,210))
        arch = int(t * 8)  # lumbar gap closes
        lying(d, cy=168, cx_head=52,
              knee_l_bend=70, knee_r_bend=70,
              hip_offset=-arch)
        # arrow showing pelvis rotation
        if t > 0.2:
            ax = 185
            d.arc([ax-12, 155, ax+12, 180], start=200, end=340,
                  fill=ORANGE, width=3)
        frames.append(img)
    save(frames, f'{OUT}/lower-back-pain-pelvic-tilt.gif')

def lower_back_pain_dead_bug():
    """死蟲式: lying, opposite arm+leg extend"""
    frames = []
    for t in ping_pong(14):
        img, d = frame()
        d.rectangle([30, 202, 290, 212], fill=(220,215,210))
        # body flat
        lying(d, cy=168, cx_head=52,
              arm_l_up=80,  # both arms up
              arm_r_up=80,
              knee_l_bend=90, knee_r_bend=90,
              hip_l_raise=30, hip_r_raise=30)
        # right arm extends back, left leg extends forward
        ext = int(t * 50)
        seg(d, pt(172, 158), pt(172 - ext, 158 - int(t*5)), ORANGE, 4)
        seg(d, pt(228, 175), pt(228 + ext, 175 + int(t*5)), ORANGE, 4)
        frames.append(img)
    save(frames, f'{OUT}/lower-back-pain-dead-bug.gif')

def lower_back_pain_bridge():
    """橋式: lying knees bent, hips rise"""
    frames = []
    for t in ping_pong(14):
        img, d = frame()
        d.rectangle([30, 202, 290, 212], fill=(220,215,210))
        rise = int(t * 42)
        lying(d, cy=168 - rise//3, cx_head=52,
              knee_l_bend=80, knee_r_bend=80,
              hip_offset=-rise)
        # hips highlighted when raised
        if t > 0.3:
            dot(d, pt(215, 168 - rise - rise//3 + 5), r=6, c=ORANGE)
        frames.append(img)
    save(frames, f'{OUT}/lower-back-pain-bridge.gif')

# ─── 五十肩 ──────────────────────────────────────────────────────────

def frozen_shoulder_pendulum():
    """鐘擺運動: lean forward, arm swings"""
    frames = []
    for i in range(14):
        t = i / 13
        # swing: sin pattern
        swing = math.sin(t * math.pi * 2) * 30
        img, d = frame()
        # table support
        d.rectangle([220, 130, 300, 140], fill=SHADOW)
        # figure leaning on table
        cx = 155
        head(d, cx, 90)
        seg(d, pt(cx, 103), pt(cx, 155), DARK)      # torso (leaned ~20°)
        seg(d, pt(cx-20, 125), pt(cx+20, 125), DARK) # shoulders
        seg(d, pt(cx-18, 150), pt(cx+18, 150), DARK) # hips
        # support arm on table
        seg(d, pt(cx+20, 125), pt(cx+65, 133), DARK)
        seg(d, pt(cx+65, 133), pt(cx+85, 133), DARK)
        # swinging arm (orange)
        arm_top = pt(cx-20, 125)
        arm_bot = pt(int(cx-20+swing), 165)
        wrist   = pt(int(cx-20+swing*1.1), 193)
        seg(d, arm_top, arm_bot, ORANGE, 4)
        seg(d, arm_bot, wrist,   ORANGE, 4)
        # legs
        seg(d, pt(cx-18, 150), pt(cx-22, 205), DARK)
        seg(d, pt(cx+18, 150), pt(cx+22, 205), DARK)
        frames.append(img)
    save(frames, f'{OUT}/frozen-shoulder-pendulum.gif')

def frozen_shoulder_table_slide():
    """桌面滑行: seated, arm slides forward on table"""
    frames = []
    for t in ping_pong(12):
        img, d = frame()
        # table
        d.rectangle([60, 120, 280, 132], fill=SHADOW)
        d.rectangle([240, 132, 270, 210], fill=SHADOW)
        # figure seated
        cx, cy = 120, 145
        head(d, cx, 80)
        seg(d, pt(cx, 93), pt(cx, 135), DARK)
        seg(d, pt(cx-18, 110), pt(cx+18, 110), DARK)
        seg(d, pt(cx-12, 135), pt(cx+12, 135), DARK)
        # legs on chair
        seg(d, pt(cx-12, 135), pt(cx-12, 165), DARK)
        seg(d, pt(cx+12, 135), pt(cx+12, 165), DARK)
        seg(d, pt(cx-12, 165), pt(cx-30, 185), DARK)
        seg(d, pt(cx+12, 165), pt(cx+30, 185), DARK)
        # sliding arm (orange)
        slide = int(t * 80)
        seg(d, pt(cx+18, 110), pt(cx+40+slide, 122), ORANGE, 4)
        seg(d, pt(cx+40+slide, 122), pt(cx+65+slide, 122), ORANGE, 4)
        frames.append(img)
    save(frames, f'{OUT}/frozen-shoulder-table-slide.gif')

def frozen_shoulder_wall_walk():
    """手指爬牆: standing, arm raises along wall"""
    frames = []
    for t in ping_pong(14):
        img, d = frame()
        # wall
        d.rectangle([240, 20, 258, 212], fill=SHADOW)
        # finger position walks up
        fy = int(180 - t * 100)
        standing(d, cx=150,
                 arm_r_angle=int(340 - t*100),
                 elbow_r_bend=int(t*15))
        # finger dots on wall
        dot(d, pt(242, fy), r=5, c=ORANGE)
        frames.append(img)
    save(frames, f'{OUT}/frozen-shoulder-wall-walk.gif')

def frozen_shoulder_resistance_band():
    """彈力帶外旋: standing, forearm rotates outward"""
    frames = []
    for t in ping_pong(12):
        img, d = frame()
        # door anchor point
        d.rectangle([258, 100, 270, 115], fill=SHADOW)
        standing(d, cx=155,
                 arm_r_angle=int(90 + t*50),
                 elbow_r_bend=int(-80 + t*(-20)))
        # band line
        seg(d, pt(258, 107), pt(220, int(130 + t*20)), GREEN, 3)
        frames.append(img)
    save(frames, f'{OUT}/frozen-shoulder-resistance-band.gif')

# ─── 膝關節炎 ────────────────────────────────────────────────────────

def knee_oa_ankle_pump():
    """踝關節幫浦: seated, foot flexes up/down"""
    frames = []
    for t in ping_pong(12):
        img, d = frame()
        # chair
        d.rectangle([80, 160, 200, 172], fill=SHADOW)
        d.rectangle([85, 172, 100, 210], fill=SHADOW)
        d.rectangle([185, 172, 200, 210], fill=SHADOW)
        # figure seated
        cx = 140
        head(d, cx, 90)
        seg(d, pt(cx, 103), pt(cx, 158), DARK)
        seg(d, pt(cx-20, 120), pt(cx+20, 120), DARK)
        seg(d, pt(cx-15, 158), pt(cx+15, 158), DARK)
        seg(d, pt(cx-15, 158), pt(cx-15, 200), DARK)
        seg(d, pt(cx+15, 158), pt(cx+15, 200), DARK)
        # right foot pumping (orange)
        foot_angle = int(t * 30)
        kn = pt(cx+15, 200)
        an = pt(cx+15 + int(t*5), 220)
        toe = pt(an[0] + int(math.sin(math.radians(foot_angle))*20),
                 an[1] - int(math.cos(math.radians(foot_angle))*10))
        seg(d, kn, an, ORANGE, 4)
        seg(d, an, toe, ORANGE, 4)
        frames.append(img)
    save(frames, f'{OUT}/knee-oa-ankle-pump.gif')

def knee_oa_quad_set():
    """股四頭肌等長: seated/lying, leg straight + tighten"""
    frames = []
    for t in ping_pong(12):
        img, d = frame()
        d.rectangle([30, 202, 290, 212], fill=(220,215,210))
        lying(d, cy=168, cx_head=52,
              knee_l_bend=0, knee_r_bend=0)
        # muscle highlight on right quad
        qx, qy = 235, 165
        r = int(8 + t * 5)
        d.ellipse([qx-r, qy-r, qx+r, qy+r],
                  outline=ORANGE, width=int(1+t*3))
        frames.append(img)
    save(frames, f'{OUT}/knee-oa-quad-set.gif')

def knee_oa_mini_squat():
    """迷你深蹲: standing, partial squat"""
    frames = []
    for t in ping_pong(14):
        img, d = frame()
        # chair back for support
        d.rectangle([240, 60, 254, 210], fill=SHADOW)
        d.rectangle([230, 60, 258, 76], fill=SHADOW)
        squat = int(t * 28)
        standing(d, cx=150, ground=208 - squat,
                 lean=int(t*10),
                 knee_l_bend=int(t*35),
                 knee_r_bend=int(t*35),
                 arm_r_angle=int(320 + t*10))
        frames.append(img)
    save(frames, f'{OUT}/knee-oa-mini-squat.gif')

# ─── 網球肘 ──────────────────────────────────────────────────────────

def tennis_elbow_wrist_rest():
    """手腕休息擺位: forearm on table, wrist relaxed"""
    frames = []
    for i in range(10):
        img, d = frame()
        # table
        d.rectangle([60, 140, 280, 152], fill=SHADOW)
        # seated figure
        cx = 130
        head(d, cx, 80)
        seg(d, pt(cx, 93), pt(cx, 138), DARK)
        seg(d, pt(cx-18, 110), pt(cx+18, 110), DARK)
        seg(d, pt(cx-12, 138), pt(cx+12, 138), DARK)
        seg(d, pt(cx-12, 138), pt(cx-20, 185), DARK)
        seg(d, pt(cx+12, 138), pt(cx+20, 185), DARK)
        # forearm resting on table (orange = affected area)
        seg(d, pt(cx+18, 110), pt(cx+60, 142), DARK)
        seg(d, pt(cx+60, 142), pt(cx+120, 142), DARK)
        # wrist highlight
        dot(d, pt(cx+60, 142), r=7, c=ORANGE)
        frames.append(img)
    save(frames, f'{OUT}/tennis-elbow-wrist-rest.gif', dur=200)

def tennis_elbow_wrist_extension():
    """手腕伸展: arm extended, wrist bends down"""
    frames = []
    for t in ping_pong(12):
        img, d = frame()
        standing(d, cx=155, arm_r_angle=80, elbow_r_bend=0)
        # wrist bending (orange)
        wr_base = pt(225, 148)
        bend = int(t * 35)
        hand = pt(225 + int(math.sin(math.radians(90+bend))*24),
                  148 + int(math.cos(math.radians(90+bend))*24))
        seg(d, wr_base, hand, ORANGE, 4)
        # other hand pressing
        seg(d, pt(190, 125), wr_base, GREEN, 3)
        frames.append(img)
    save(frames, f'{OUT}/tennis-elbow-wrist-extension.gif')

def tennis_elbow_eccentric_wrist():
    """離心式手腕訓練: seated, wrist lowers weight slowly"""
    frames = []
    for t in ping_pong(12):
        img, d = frame()
        d.rectangle([60, 140, 200, 152], fill=SHADOW)
        cx = 130
        head(d, cx, 82)
        seg(d, pt(cx, 95), pt(cx, 140), DARK)
        seg(d, pt(cx-18, 112), pt(cx+18, 112), DARK)
        seg(d, pt(cx-12, 140), pt(cx+12, 140), DARK)
        seg(d, pt(cx-12, 140), pt(cx-18, 185), DARK)
        seg(d, pt(cx+12, 140), pt(cx+18, 185), DARK)
        # forearm on thigh, wrist drops
        drop = int(t * 30)
        seg(d, pt(cx+18, 112), pt(cx+55, 145), DARK)
        seg(d, pt(cx+55, 145), pt(cx+95, 142), DARK)
        # hand with weight
        wr = pt(cx+95, 142)
        hand_y = 142 + drop
        seg(d, wr, pt(wr[0], hand_y), ORANGE, 4)
        # dumbbell
        d.ellipse([wr[0]-8, hand_y, wr[0]+8, hand_y+10],
                  outline=DARK, width=2)
        frames.append(img)
    save(frames, f'{OUT}/tennis-elbow-eccentric-wrist.gif')

# ─── 腕隧道症候群 ─────────────────────────────────────────────────────

def carpal_tunnel_neutral():
    """手腕中立位: seated at desk, wrist straight"""
    frames = []
    for i in range(10):
        img, d = frame()
        d.rectangle([60, 140, 280, 152], fill=SHADOW)
        cx = 130
        head(d, cx, 82)
        seg(d, pt(cx, 95), pt(cx, 140), DARK)
        seg(d, pt(cx-18, 112), pt(cx+18, 112), DARK)
        seg(d, pt(cx-12, 140), pt(cx+12, 140), DARK)
        seg(d, pt(cx-12, 140), pt(cx-18, 185), DARK)
        seg(d, pt(cx+12, 140), pt(cx+18, 185), DARK)
        # arm straight to keyboard (neutral)
        seg(d, pt(cx+18, 112), pt(cx+70, 140), DARK)
        seg(d, pt(cx+70, 140), pt(cx+130, 140), DARK)
        # green = good posture
        dot(d, pt(cx+70, 140), r=6, c=GREEN)
        # brace indicator
        d.rectangle([cx+75, 133, cx+110, 148],
                    outline=ORANGE, width=2)
        frames.append(img)
    save(frames, f'{OUT}/carpal-tunnel-neutral.gif', dur=500)

def carpal_tunnel_tendon_glide():
    """肌腱滑動: hand cycles through positions"""
    positions = [
        # straight: fingers up
        [(0,0),(0,-18),(0,-14),(0,-14),(0,-14)],
        # hook: first joint bends
        [(0,0),(0,-18),(8,-12),(8,-12),(8,-12)],
        # fist: full bend
        [(0,0),(0,-18),(15,-6),(12,2),(8,8)],
    ]
    frames = []
    # cycle through positions
    for rep in range(2):
        for pos_idx in range(3):
            for t in [0.0, 0.5, 1.0]:
                img, d = frame()
                bx, by = 160, 160
                # palm
                d.rectangle([bx-18, by-10, bx+18, by+15],
                             outline=DARK, width=LW)
                p = positions[pos_idx]
                prev_tip = None
                for fi, (dx, dy) in enumerate(p[1:], 0):
                    fx = bx - 14 + fi*10
                    tip = pt(fx+dx, by-10+dy)
                    base = pt(fx, by-10)
                    seg(d, base, tip, DARK if fi < 4 else ORANGE)
                frames.append(img)
    save(frames, f'{OUT}/carpal-tunnel-tendon-glide.gif', dur=300)

def carpal_tunnel_grip_strength():
    """握力訓練: hand squeezes ball"""
    frames = []
    for t in ping_pong(12):
        img, d = frame()
        bx, by = 160, 150
        # arm
        seg(d, pt(bx-60, 120), pt(bx-10, 145), DARK)
        # ball (squishes slightly)
        r_x = int(28 - t*5)
        r_y = int(25 + t*4)
        d.ellipse([bx-r_x, by-r_y, bx+r_x, by+r_y],
                  outline=GREEN, width=LW)
        # fingers wrapping
        for angle in [210, 240, 270, 300, 330]:
            a = math.radians(angle)
            fp = pt(bx + int(math.cos(a)*(r_x+2)),
                    by + int(math.sin(a)*(r_y+2)))
            tip = pt(bx + int(math.cos(a)*(r_x+18-t*8)),
                     by + int(math.sin(a)*(r_y+16-t*8)))
            seg(d, fp, tip, DARK)
        frames.append(img)
    save(frames, f'{OUT}/carpal-tunnel-grip-strength.gif')

# ─── 頸椎病 ──────────────────────────────────────────────────────────

def cervical_chin_tuck():
    """下巴收縮: head pulls back"""
    frames = []
    for t in ping_pong(12):
        img, d = frame()
        # chair
        d.rectangle([200, 80, 220, 210], fill=SHADOW)
        standing(d, cx=155, lean=0)
        # head position shifts back
        pull = int(t * 12)
        head(d, 155 - pull, 65, ORANGE)
        # arrow showing direction
        if t > 0.15:
            d.line([(165-pull, 68), (165-pull-15, 68)],
                   fill=ORANGE, width=2)
            d.polygon([(165-pull-15, 65), (165-pull-22, 68),
                       (165-pull-15, 71)], fill=ORANGE)
        frames.append(img)
    save(frames, f'{OUT}/cervical-chin-tuck.gif')

def cervical_rotation():
    """頸部旋轉: head turns side to side"""
    frames = []
    for i in range(16):
        t = i / 15
        angle = math.sin(t * math.pi * 2) * 30  # -30 to +30 degrees
        img, d = frame()
        standing(d, cx=155)
        # re-draw head with rotation hint
        # show chin offset for rotation
        chin_x = int(155 + math.sin(math.radians(angle)) * 12)
        d.ellipse([155-HR, 65-HR, 155+HR, 65+HR], fill=BG,
                  outline=DARK, width=LW)
        # face direction dot
        dot(d, pt(chin_x, 68), r=4, c=ORANGE)
        frames.append(img)
    save(frames, f'{OUT}/cervical-rotation.gif', dur=120)

def cervical_isometric():
    """頸部等長阻力: hand presses head, no movement"""
    frames = []
    for t in ping_pong(12):
        img, d = frame()
        standing(d, cx=155, arm_r_angle=355, elbow_r_bend=-70)
        # hand on forehead indicator
        dot(d, pt(167, 62), r=7, c=ORANGE)
        # pressure lines
        if t > 0.2:
            for dy in [-4, 0, 4]:
                seg(d, pt(175, 62+dy), pt(167+int(t*5), 62+dy),
                    ORANGE, max(1, int(t*3)))
        frames.append(img)
    save(frames, f'{OUT}/cervical-isometric.gif')

# ─── 足底筋膜炎 ──────────────────────────────────────────────────────

def plantar_ice_roll():
    """冰水瓶滾壓: seated, foot rolls bottle"""
    frames = []
    for i in range(14):
        t = i / 13
        roll_x = int(130 + math.sin(t * math.pi * 3) * 28)
        img, d = frame()
        # chair
        d.rectangle([80, 160, 200, 172], fill=SHADOW)
        d.rectangle([85, 172, 100, 210], fill=SHADOW)
        d.rectangle([185, 172, 200, 210], fill=SHADOW)
        # bottle on ground
        d.ellipse([roll_x-15, 195, roll_x+15, 215],
                  outline=GREEN, fill=(200,235,220), width=2)
        # seated figure
        cx = 140
        head(d, cx, 90)
        seg(d, pt(cx, 103), pt(cx, 160), DARK)
        seg(d, pt(cx-20, 120), pt(cx+20, 120), DARK)
        seg(d, pt(cx-15, 160), pt(cx+15, 160), DARK)
        seg(d, pt(cx-15, 160), pt(roll_x-8, 198), DARK)
        seg(d, pt(cx+15, 160), pt(roll_x+8, 198), DARK)
        # foot
        seg(d, pt(roll_x-8, 198), pt(roll_x+14, 196), ORANGE, 4)
        frames.append(img)
    save(frames, f'{OUT}/plantar-ice-roll.gif', dur=150)

def plantar_calf_stretch():
    """小腿伸展: standing at wall, back leg stretch"""
    frames = []
    for t in ping_pong(12):
        img, d = frame()
        # wall
        d.rectangle([240, 20, 258, 212], fill=SHADOW)
        # lunge stance
        step_back = int(t * 20)
        # front leg slightly bent
        standing(d, cx=160,
                 arm_l_angle=260, arm_r_angle=280,
                 lean=int(t*12),
                 knee_l_bend=int(t*20),
                 knee_r_bend=0)
        # back foot flat (orange highlight)
        dot(d, pt(145, 207), r=6, c=ORANGE)
        # hands on wall
        seg(d, pt(182, 115), pt(240, 100), DARK, 3)
        seg(d, pt(178, 115), pt(240, 115), DARK, 3)
        frames.append(img)
    save(frames, f'{OUT}/plantar-calf-stretch.gif')

def plantar_towel_scrunch():
    """毛巾抓握: foot scrunch towel"""
    frames = []
    for t in ping_pong(12):
        img, d = frame()
        # chair
        d.rectangle([80, 155, 200, 168], fill=SHADOW)
        # towel on ground
        towel_w = int(80 - t*25)
        d.rectangle([110, 200, 110+towel_w, 210],
                    fill=(220,215,210), outline=SHADOW)
        # seated figure
        cx = 140
        head(d, cx, 85)
        seg(d, pt(cx, 98), pt(cx, 155), DARK)
        seg(d, pt(cx-18, 115), pt(cx+18, 115), DARK)
        seg(d, pt(cx-13, 155), pt(cx+13, 155), DARK)
        seg(d, pt(cx-13, 155), pt(cx-13, 200), DARK)
        seg(d, pt(cx+13, 155), pt(cx+13, 200), DARK)
        # foot scrunch (toes curl)
        curl = int(t * 15)
        foot_base = pt(cx-13, 200)
        seg(d, foot_base, pt(cx-13+24, 202), DARK)
        seg(d, pt(cx-13+24, 202), pt(cx-13+24+curl, 202+curl), ORANGE, 4)
        frames.append(img)
    save(frames, f'{OUT}/plantar-towel-scrunch.gif')

# ─── 旋轉肌袖 ────────────────────────────────────────────────────────

def rotator_scapular_setting():
    """肩胛骨穩定: shoulders squeeze back"""
    frames = []
    for t in ping_pong(12):
        img, d = frame()
        squeeze = int(t * 8)
        standing(d, cx=160, shoulder_width=22-squeeze)
        # shoulder blade arrows
        if t > 0.1:
            seg(d, pt(175, 115), pt(175+int(t*10), 115), ORANGE, 3)
            seg(d, pt(145, 115), pt(145-int(t*10), 115), ORANGE, 3)
        frames.append(img)
    save(frames, f'{OUT}/rotator-scapular-setting.gif')

def rotator_side_lying_rotation():
    """側臥外旋: side-lying, forearm rotates up"""
    frames = []
    for t in ping_pong(14):
        img, d = frame()
        d.rectangle([30, 200, 290, 210], fill=(220,215,210))
        # side-lying figure (simplified profile)
        by = 170
        # body line
        seg(d, pt(60, by), pt(220, by), DARK)
        head(d, 50, by)
        # knees bent for stability
        seg(d, pt(180, by), pt(190, by+25), DARK)
        seg(d, pt(190, by+25), pt(185, by+50), DARK)
        seg(d, pt(200, by), pt(210, by+25), DARK)
        seg(d, pt(210, by+25), pt(205, by+50), DARK)
        # upper arm pinned, forearm rotates
        sh = pt(120, by)
        el = pt(120, by - 5)   # elbow at side
        # forearm rotates from down to up
        rot = int(t * 90)
        a = math.radians(-90 + rot)
        wr = pt(el[0] + int(math.cos(a)*30),
                el[1] + int(math.sin(a)*30))
        seg(d, sh, el, DARK)
        seg(d, el, wr, ORANGE, 4)
        frames.append(img)
    save(frames, f'{OUT}/rotator-side-lying-rotation.gif')

def rotator_band_pull_apart():
    """彈力帶水平後拉: arms pull band apart"""
    frames = []
    for t in ping_pong(12):
        img, d = frame()
        spread = int(t * 35)
        standing(d, cx=160,
                 arm_l_angle=int(270-spread//2),
                 arm_r_angle=int(270+spread//2),
                 elbow_l_bend=0, elbow_r_bend=0)
        # band between hands
        l_hand = pt(160 - 32 - spread, 128)
        r_hand = pt(160 + 32 + spread, 128)
        seg(d, l_hand, r_hand, GREEN, 3)
        frames.append(img)
    save(frames, f'{OUT}/rotator-band-pull-apart.gif')

# ─── 髖關節炎 ────────────────────────────────────────────────────────

def hip_oa_lying_abduction():
    """仰臥髖外展: leg slides sideways"""
    frames = []
    for t in ping_pong(12):
        img, d = frame()
        d.rectangle([30, 200, 290, 210], fill=(220,215,210))
        abduct = int(t * 30)
        lying(d, cy=168, cx_head=52,
              knee_l_bend=0, knee_r_bend=0)
        # right leg slides out (orange)
        hp = pt(227, 175)
        kn = pt(227 + abduct//2, 175)
        an = pt(280 + abduct, 175)
        seg(d, hp, kn, ORANGE, 4)
        seg(d, kn, an, ORANGE, 4)
        frames.append(img)
    save(frames, f'{OUT}/hip-oa-lying-abduction.gif')

def hip_oa_clam_shell():
    """蛤蜊式: side-lying, top knee opens"""
    frames = []
    for t in ping_pong(14):
        img, d = frame()
        d.rectangle([30, 198, 290, 208], fill=(220,215,210))
        by = 165
        # body
        seg(d, pt(60, by), pt(220, by), DARK)
        head(d, 50, by)
        # bottom leg (bent, stays)
        seg(d, pt(185, by+5), pt(210, by+32), DARK)
        seg(d, pt(210, by+32), pt(210, by+55), DARK)
        # top leg opens
        open_angle = int(t * 38)
        a = math.radians(120 - open_angle)
        kn = pt(int(185 + math.cos(a)*45), int(by + math.sin(a)*45))
        an = pt(int(kn[0] + math.cos(math.radians(100-open_angle))*42),
                int(kn[1] + math.sin(math.radians(100-open_angle))*42))
        seg(d, pt(185, by), kn, ORANGE, 4)
        seg(d, kn, an, ORANGE, 4)
        frames.append(img)
    save(frames, f'{OUT}/hip-oa-clam-shell.gif')

def hip_oa_squat():
    """扶椅深蹲: squat holding chair"""
    frames = []
    for t in ping_pong(14):
        img, d = frame()
        # chair
        d.rectangle([230, 80, 250, 210], fill=SHADOW)
        d.rectangle([220, 80, 258, 96], fill=SHADOW)
        squat = int(t * 35)
        standing(d, cx=155, ground=208-squat,
                 lean=int(t*8),
                 knee_l_bend=int(t*40), knee_r_bend=int(t*40),
                 arm_r_angle=320, arm_l_angle=240)
        frames.append(img)
    save(frames, f'{OUT}/hip-oa-squat.gif')

# ─── 阿基里斯腱炎 ───────────────────────────────────────────────────

def achilles_eccentric_seated():
    """坐姿踝關節活動: seated foot flexes"""
    frames = []
    for t in ping_pong(12):
        img, d = frame()
        d.rectangle([80, 158, 200, 170], fill=SHADOW)
        cx = 140
        head(d, cx, 86)
        seg(d, pt(cx, 99), pt(cx, 158), DARK)
        seg(d, pt(cx-18, 116), pt(cx+18, 116), DARK)
        seg(d, pt(cx-13, 158), pt(cx+13, 158), DARK)
        # legs
        seg(d, pt(cx-13, 158), pt(cx-20, 200), DARK)
        seg(d, pt(cx+13, 158), pt(cx+20, 200), DARK)
        # right foot: flex up (dorsiflexion)
        flex = int(t * 30)
        an = pt(cx+20, 200)
        toe = pt(an[0]+int(math.cos(math.radians(-70+flex))*22),
                 an[1]+int(math.sin(math.radians(-70+flex))*22))
        seg(d, an, toe, ORANGE, 4)
        dot(d, an, r=5, c=ORANGE)
        frames.append(img)
    save(frames, f'{OUT}/achilles-eccentric-seated.gif')

def achilles_eccentric_calf():
    """離心小腿訓練（平地）: heel lowers slowly"""
    frames = []
    for t in ping_pong(14):
        img, d = frame()
        lower = int(t * 28)  # heel lowers
        standing(d, cx=160, ground=208-28+lower,
                 lean=0,
                 arm_l_angle=240, arm_r_angle=320)
        # heel highlight
        dot(d, pt(148, 208-28+lower+10), r=6, c=ORANGE)
        dot(d, pt(172, 208-28+lower+10), r=6, c=ORANGE)
        # slow arrow
        if t > 0.1:
            ay = 208-28+lower
            d.line([(155, ay), (155, ay+int(t*10))],
                   fill=ORANGE, width=2)
            d.polygon([(150, ay+int(t*10)), (160, ay+int(t*10)),
                       (155, ay+int(t*10)+8)], fill=ORANGE)
        frames.append(img)
    save(frames, f'{OUT}/achilles-eccentric-calf.gif', dur=180)

def achilles_eccentric_step():
    """離心小腿訓練（階梯）: heel drops below step"""
    frames = []
    for t in ping_pong(14):
        img, d = frame()
        # step
        d.rectangle([100, 165, 240, 210], fill=SHADOW)
        d.rectangle([55, 185, 100, 210], fill=(210,205,200))
        lower = int(t * 25)
        standing(d, cx=165, ground=162,
                 arm_l_angle=245, arm_r_angle=315)
        # heel drops
        dot(d, pt(148, 163+lower), r=6, c=ORANGE)
        dot(d, pt(178, 163+lower), r=6, c=ORANGE)
        # handrail
        seg(d, pt(80, 130), pt(80, 185), SHADOW, 4)
        frames.append(img)
    save(frames, f'{OUT}/achilles-eccentric-step.gif', dur=180)

# ══════════════════════════════════════════════════════════════════
#  MAIN
# ══════════════════════════════════════════════════════════════════

if __name__ == '__main__':
    exercises = [
        # 下背痛
        lower_back_pain_knee_to_chest,
        lower_back_pain_cat_cow,
        lower_back_pain_bird_dog,
        lower_back_pain_pelvic_tilt,
        lower_back_pain_dead_bug,
        lower_back_pain_bridge,
        # 五十肩
        frozen_shoulder_pendulum,
        frozen_shoulder_table_slide,
        frozen_shoulder_wall_walk,
        frozen_shoulder_resistance_band,
        # 膝關節炎
        knee_oa_ankle_pump,
        knee_oa_quad_set,
        knee_oa_mini_squat,
        # 網球肘
        tennis_elbow_wrist_rest,
        tennis_elbow_wrist_extension,
        tennis_elbow_eccentric_wrist,
        # 腕隧道
        carpal_tunnel_neutral,
        carpal_tunnel_tendon_glide,
        carpal_tunnel_grip_strength,
        # 頸椎病
        cervical_chin_tuck,
        cervical_rotation,
        cervical_isometric,
        # 足底筋膜炎
        plantar_ice_roll,
        plantar_calf_stretch,
        plantar_towel_scrunch,
        # 旋轉肌袖
        rotator_scapular_setting,
        rotator_side_lying_rotation,
        rotator_band_pull_apart,
        # 髖關節炎
        hip_oa_lying_abduction,
        hip_oa_clam_shell,
        hip_oa_squat,
        # 阿基里斯腱炎
        achilles_eccentric_seated,
        achilles_eccentric_calf,
        achilles_eccentric_step,
    ]

    print(f'Generating {len(exercises)} GIFs...')
    for fn in exercises:
        name = fn.__name__.replace('_', '-')
        try:
            fn()
            print(f'  ✓ {name}')
        except Exception as e:
            print(f'  ✗ {name}: {e}')

    print('Done.')
