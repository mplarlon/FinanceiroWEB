from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "output" / "video-explicativo"
SCENES = [
    ("01-charlie.png", "Charlie", "Consultas financeiras em linguagem natural, com respostas baseadas nos dados do sistema."),
    ("02-visao-geral.png", "Visão geral", "Acompanhe os indicadores principais e identifique rapidamente os pontos que exigem atenção."),
    ("03-contas-financeiras.png", "Contas a pagar e receber", "Filtre títulos, consulte vencimentos e execute quitações, acordos e cancelamentos."),
    ("04-nova-conta.png", "Novo lançamento", "Cadastre contas com empresa, cliente ou fornecedor, vencimento, forma prevista e classificação contábil."),
    ("05-controle-caixa.png", "Controle de caixa", "Abra e feche caixas, transfira valores e acompanhe entradas, saídas, saldo e horários de pico."),
    ("06-conciliacao.png", "Conciliação financeira", "Importe extratos OFX, confira correspondências e trate os itens ainda não conciliados."),
    ("07-fechamento-carteira.png", "Fechamento de carteira", "Consulte o período desejado e confira os valores de carteira por cliente."),
    ("08-fiscal.png", "Módulo fiscal", "Consulte notas fiscais, acompanhe status e acesse revisão fiscal e fechamento por CFOP."),
]

font_regular = ImageFont.truetype(r"C:\Windows\Fonts\segoeui.ttf", 34)
font_bold = ImageFont.truetype(r"C:\Windows\Fonts\segoeuib.ttf", 54)

def wrap(draw, text, font, width):
    words, lines, current = text.split(), [], ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if draw.textbbox((0, 0), candidate, font=font)[2] <= width:
            current = candidate
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines

for index, (filename, title, caption) in enumerate(SCENES, 1):
    source = Image.open(OUT / filename).convert("RGB")
    background = source.resize((1920, 1080)).filter(ImageFilter.GaussianBlur(24))
    overlay = Image.new("RGBA", background.size, (10, 24, 48, 120))
    background = Image.alpha_composite(background.convert("RGBA"), overlay)
    source.thumbnail((1780, 820), Image.Resampling.LANCZOS)
    x = (1920 - source.width) // 2
    y = 50
    background.alpha_composite(source.convert("RGBA"), (x, y))
    draw = ImageDraw.Draw(background)
    draw.rounded_rectangle((60, 895, 1860, 1050), radius=24, fill=(8, 24, 48, 235), outline=(45, 118, 214, 255), width=3)
    draw.text((95, 915), title, font=font_bold, fill="white")
    lines = wrap(draw, caption, font_regular, 1110)
    for row, line in enumerate(lines[:2]):
        draw.text((700, 920 + row * 45), line, font=font_regular, fill=(220, 232, 248, 255))
    background.convert("RGB").save(OUT / f"frame-{index:02}.jpg", quality=94)
