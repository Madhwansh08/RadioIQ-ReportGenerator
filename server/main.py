from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydicom import dcmread
from pydicom.errors import InvalidDicomError
from pydicom.pixel_data_handlers.util import apply_voi_lut
import io
import json
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from reportlab.lib.pagesizes import letter
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak
from reportlab.platypus import Image as RLImage
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors
from reportlab.lib.units import inch
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.utils import ImageReader
from datetime import datetime
import os

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

def process_dicom(file_stream):
    try:
        dicom = dcmread(file_stream)
        pixel_array = apply_voi_lut(dicom.pixel_array, dicom)
        pixel_array = (pixel_array - pixel_array.min()) / (pixel_array.max() - pixel_array.min()) * 255.0
        pixel_array = pixel_array.astype(np.uint8)
        if dicom.PhotometricInterpretation == 'MONOCHROME1':
            pixel_array = np.invert(pixel_array)
        return Image.fromarray(pixel_array)
    except InvalidDicomError as e:
        raise HTTPException(status_code=400, detail=f"DICOM processing error: {e}")

def process_image(file: UploadFile, abnormalities: list):
    ext = file.filename.rsplit('.', 1)[-1].lower()
    content = io.BytesIO(file.file.read())
    if ext in ('dcm', 'dicom', 'dic'):
        img = process_dicom(content)
    elif ext == 'png':
        img = Image.open(content)
    else:
        raise HTTPException(status_code=400, detail="Unsupported file format")

    orig_w, orig_h = img.size
    target = 1024
    img_resized = img.resize((target, target)).convert('RGB')
    annotated = img_resized.copy()
    draw = ImageDraw.Draw(annotated)
    font = ImageFont.load_default()

    sx, sy = target / orig_w, target / orig_h
    for ab in abnormalities:
        bbox = ab.get('bbox', {})
        label = ab.get('name', '')
        try:
            x = float(bbox.get('x', 0)) * sx
            y = float(bbox.get('y', 0)) * sy
            w = float(bbox.get('width', 0)) * sx
            h = float(bbox.get('height', 0)) * sy
            if w > 0 and h > 0:
                draw.rectangle([x, y, x + w, y + h], outline='red', width=3)
                if label:
                    draw.text((x, max(y - 14, 0)), label, fill='red', font=font)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Invalid bbox: {e}")
    return img_resized, annotated

def fetch_logo():
    base = os.path.dirname(os.path.abspath(__file__))
    path = os.path.join(base, 'assets', 'logo.png')
    try:
        # Load with alpha channel
        img = Image.open(path).convert('RGBA')
        # Desired display width in points
        disp_w = 1.5 * inch
        aspect = img.height / img.width
        disp_h = disp_w * aspect

        # Option A: flatten transparency onto white background
        bg = Image.new('RGB', img.size, (255, 255, 255))
        bg.paste(img, mask=img.split()[3])
        out = bg

        # Option B: preserve transparency instead (comment out flattening above)
        # out = img

        buf = io.BytesIO()
        out.save(buf, format='PNG')
        buf.seek(0)
        return buf, (disp_w, disp_h)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Logo load failed: {e}")

def _add_page_decorations(canvas, doc):
    canvas.saveState()
    w, h = letter

    if canvas.getPageNumber() == 1:
        try:
            logo_buf, (lw, lh) = fetch_logo()
            img_reader = ImageReader(logo_buf)
            canvas.drawImage(
                img_reader,
                doc.leftMargin,
                h - lh - 10,
                width=lw,
                height=lh,
                mask='auto'  # use mask to preserve transparency if desired
            )
        except:
            pass

        # Date/time on first page
        date = datetime.now().strftime('Date: %Y-%m-%d')
        time = datetime.now().strftime('Time: %H:%M:%S')
        canvas.setFont('Helvetica', 10)
        canvas.drawRightString(w - doc.rightMargin, h - doc.topMargin + 20, date)
        canvas.drawRightString(w - doc.rightMargin, h - doc.topMargin + 4, time)

    # Footer disclaimer
    footer = (
        "This is an AI generated report. The findings are to be used for diagnostic purposes "
        "in consultation with a licensed medical expert."
    )
    canvas.setFont('Helvetica', 8)
    canvas.drawCentredString(w / 2.0, doc.bottomMargin / 2, footer)
    canvas.restoreState()

def generate_pdf_report(orig, ann, det, abnormal, ab_list):
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=letter,
        leftMargin=0.75 * inch,
        rightMargin=0.75 * inch,
        topMargin=1 * inch,
        bottomMargin=1 * inch,
    )
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(
        'Header', fontName='Helvetica-Bold', fontSize=24,
        leading=28, alignment=TA_CENTER, spaceAfter=12
    ))
    styles.add(ParagraphStyle(
        'SectionHeader', fontName='Helvetica-Bold', fontSize=12,
        leading=14, spaceAfter=6, textColor=colors.HexColor('#003366')
    ))
    styles.add(ParagraphStyle(
        'SubHeader', fontName='Helvetica-Bold', fontSize=11,
        leading=13, spaceAfter=4
    ))
    styles.add(ParagraphStyle('CustomNormal', fontSize=10, leading=12))

    elems = []
    elems.append(Spacer(1, 24))
    elems.append(Paragraph('CXR Medical Report', styles['Header']))
    elems.append(Spacer(1, 12))

    # Patient details
    elems.append(Paragraph('PATIENT DETAILS', styles['SectionHeader']))
    left = [
        ['Name:', det.get('patientName', 'N/A')],
        ['ID:', det.get('patientId', 'N/A')],
        ['Gender:', det.get('gender', 'N/A')],
        ['Age:', det.get('age', 'N/A')],
        ['Location:', det.get('location', 'N/A')],
    ]
    right = [
        ['Exam Date:', det.get('dateOfExam', 'N/A')],
        ['Physician:', det.get('referredPhysician', 'N/A')],
        ['Radiologist:', det.get('radiologist', 'N/A')],
        ['Exam Type:', det.get('examType', 'N/A')],
        ['Body Part:', det.get('bodyPart', 'N/A')],
    ]
    tblL = Table(left, colWidths=[1.2 * inch, 2.3 * inch])
    tblR = Table(right, colWidths=[1.2 * inch, 2.3 * inch])
    for tbl in (tblL, tblR):
        tbl.setStyle(TableStyle([
            ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
            ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ]))
    elems.append(Table([[tblL, tblR]], colWidths=[3.5 * inch, 3.5 * inch]))
    elems.append(Spacer(1, 12))

    # Findings
    elems.append(Paragraph('FINDINGS', styles['SectionHeader']))
    if abnormal and ab_list:
        elems.append(Paragraph('Abnormalities:', styles['SubHeader']))
        for i, ab in enumerate(ab_list, 1):
            elems.append(Paragraph(f"{i}. {ab.get('name', 'Unnamed')}", styles['CustomNormal']))
    else:
        elems.append(Paragraph('Normal', styles['CustomNormal']))

    # Add gap before TB Possibility
    elems.append(Spacer(1, 12))

    elems.append(Paragraph('TB Possibility:', styles['SubHeader']))
    elems.append(Paragraph(det.get('tbPossibility', 'N/A'), styles['CustomNormal']))
    elems.append(Spacer(1, 12))

    # Doctor notes
    elems.append(Paragraph('DOCTOR NOTES', styles['SectionHeader']))
    elems.append(Paragraph(det.get('doctorNotes', 'N/A'), styles['CustomNormal']))

    # Original image
    elems.append(PageBreak())
    elems.append(Paragraph('Original X-ray Image', styles['SectionHeader']))
    ob = io.BytesIO()
    orig.save(ob, format='PNG')
    ob.seek(0)
    elems.append(RLImage(ob, width=6 * inch, height=6 * inch))

    # Annotated image
    elems.append(PageBreak())
    elems.append(Paragraph('Annotated X-ray Image', styles['SectionHeader']))
    ab_buf = io.BytesIO()
    ann.save(ab_buf, format='PNG')
    ab_buf.seek(0)
    elems.append(RLImage(ab_buf, width=6 * inch, height=6 * inch))

    doc.build(elems, onFirstPage=_add_page_decorations, onLaterPages=_add_page_decorations)
    buf.seek(0)
    return buf

@app.post('/generate-report/')
async def create_report(
    file: UploadFile = File(...),
    patientName: str = Form(''),
    dateOfExam: str = Form(''),
    patientId: str = Form(''),
    gender: str = Form(''),
    age: str = Form(''),
    location: str = Form(''),
    referredPhysician: str = Form(''),
    radiologist: str = Form(''),
    examType: str = Form(''),
    bodyPart: str = Form(''),
    tbPossibility: str = Form(''),
    doctorNotes: str = Form(''),
    isAbnormal: bool = Form(False),
    abnormalities: str = Form('[]'),
):
    if not file.filename.lower().endswith(('.dcm', '.dicom', '.dic', '.png')):
        raise HTTPException(400, detail="Invalid file format")
    try:
        ab_list = json.loads(abnormalities)
        if not isinstance(ab_list, list):
            raise ValueError('Invalid abnormalities list')
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid abnormalities: {e}")

    orig, ann = process_image(file, ab_list)
    det = {
        'patientName': patientName,
        'dateOfExam': dateOfExam,
        'patientId': patientId,
        'gender': gender,
        'age': age,
        'location': location,
        'referredPhysician': referredPhysician,
        'radiologist': radiologist,
        'examType': examType,
        'bodyPart': bodyPart,
        'tbPossibility': tbPossibility,
        'doctorNotes': doctorNotes,
    }
    pdf = generate_pdf_report(orig, ann, det, isAbnormal, ab_list)
    return StreamingResponse(
        pdf,
        media_type='application/pdf',
        headers={'Content-Disposition': 'attachment; filename=medical_report.pdf'},
    )

if __name__ == '__main__':
    import uvicorn
    # Read port & host from env (Render populates $PORT)
    port = int(os.getenv('PORT', 8000))
    host = os.getenv('HOST', '0.0.0.0')
    # If you want live‐reload in dev only:
    reload_flag = os.getenv('DEV', 'false').lower() in ('1','true','yes')

    uvicorn.run(
        "main:app",      # module:path
        host=host,
        port=port,
        reload=reload_flag  # set DEV=true locally to auto‐reload
    )