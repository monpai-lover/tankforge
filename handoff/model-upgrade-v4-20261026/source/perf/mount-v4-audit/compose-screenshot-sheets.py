#!/usr/bin/env python3
"""Arrange actual renderer screenshots. Cropping/resizing only; no scene edits."""
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont,ImageOps

ROOT=Path(__file__).resolve().parent
FONT=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',24)
SMALL=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',18)
BG='#111d22'
def cell(image,size,crop=None):
    im=Image.open(image).convert('RGB')
    if crop:im=im.crop(crop)
    return ImageOps.fit(im,size,Image.Resampling.LANCZOS)

def before_after():
    rows=[
      ('F16_Wingtip_AIM9X.png','F-16V | wingtip side channel',(230,300,1100,850)),
      ('F104G_Wingtip_AIM9B.png','F-104G | wingtip side channel',(190,270,1120,860)),
      ('MiG21_Empty_Rails_Cleaned.png','MiG-21MF | isolated black caps removed',(250,350,1130,700)),
    ]
    w,h=800,430
    sheet=Image.new('RGB',(w*2+30,80+len(rows)*(h+58)),BG);d=ImageDraw.Draw(sheet)
    d.text((15,12),'Actual renderer | same camera before / after',font=FONT,fill='white')
    d.text((15,47),'Left: previous package    Right: corrected package    Cropped for detail',font=SMALL,fill='#b4c9cd')
    for row,(file,title,crop)in enumerate(rows):
        y=80+row*(h+58)
        for col,sub in enumerate(['before-screenshots','actual-screenshots']):
            x=10+col*(w+10);d.text((x,y),title+('  BEFORE' if col==0 else '  FIXED'),font=SMALL,fill='#b4c9cd'if col==0 else '#9fe6c4')
            sheet.paste(cell(ROOT/sub/file,(w,h),crop),(x,y+28))
    out=ROOT/'TankForge_Mount_Fixes_Before_After.jpg';sheet.save(out,quality=94,subsampling=0);print(out)

def new_stores():
    rows=[
      ('F16_Wingtip_AMRAAM.png','F-16V | AIM-120 on the side channel'),
      ('F16_Source_Inner_Pylon_GBU12.png','F-16V | GBU-12 on the source inner pylon'),
      ('MiG21_Four_Stations_R3R.png','MiG-21MF | four stores, R-3S + R-3R'),
      ('MiG21_Outer_R3R_Closeup.png','MiG-21MF | separate inner and outer rails'),
      ('Mirage5F_SAMP250.png','Mirage 5F | new SAMP 250 kg model'),
      ('MiG21_Four_Stations_R60.png','MiG-21MF | four stores, R-60'),
    ]
    w,h=800,570
    sheet=Image.new('RGB',(w*2+30,64+3*(h+44)),BG);d=ImageDraw.Draw(sheet)
    d.text((15,14),'TankForge | actual mounted model review',font=FONT,fill='white')
    for index,(file,title)in enumerate(rows):
        x=10+(index%2)*(w+10);y=64+(index//2)*(h+44)
        d.text((x,y),title,font=SMALL,fill='#b4c9cd');sheet.paste(cell(ROOT/'actual-screenshots'/file,(w,h)),(x,y+28))
    out=ROOT/'TankForge_New_Catalog_Actual_Review.jpg';sheet.save(out,quality=94,subsampling=0);print(out)

before_after();new_stores()
