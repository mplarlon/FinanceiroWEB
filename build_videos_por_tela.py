import asyncio
import subprocess
from pathlib import Path

import edge_tts
import imageio_ffmpeg
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "output" / "video-explicativo"
OUT = ROOT / "output" / "videos-por-tela"
CAPTURES = OUT / "capturas"
WORK = OUT / "temporarios"
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
VOICE = "pt-BR-ThalitaMultilingualNeural"

VIDEOS = [
    {
        "file": "01_Visao_Geral.mp4",
        "title": "Visão geral",
        "image": SOURCE / "03-contas-financeiras.png",
        "segments": [
            ("Indicadores em um só lugar", "Comece pela Visão geral. Aqui você acompanha rapidamente os indicadores mais importantes do financeiro e identifica o que precisa de atenção."),
            ("Consulte o período", "Use os filtros de período para atualizar os números. Os cartões resumem entradas, saídas, contas em aberto e vencimentos, facilitando a leitura do dia."),
            ("Acompanhe tendências", "Os gráficos ajudam a comparar a evolução dos valores e a distribuição das movimentações. Assim, você sai do resumo e segue direto para a tela que precisa analisar."),
        ],
    },
    {
        "file": "02_Charlie.mp4",
        "title": "Charlie — assistente financeiro",
        "image": SOURCE / "01-charlie.png",
        "segments": [
            ("Pergunte do seu jeito", "No Charlie, você faz perguntas em linguagem natural. Por exemplo: quanto devo a um fornecedor, quais contas vencem hoje, ou o que tenho para receber."),
            ("Informe datas completas", "Para consultas por período, informe a data desejada com dia, mês e ano. O Charlie interpreta a pergunta e procura os lançamentos correspondentes."),
            ("Confira os dados", "Abra Ver dados da resposta para conferir os registros utilizados. Os atalhos abaixo da mensagem também ajudam a continuar a consulta sem precisar digitar tudo novamente."),
        ],
    },
    {
        "file": "03_Contas_Pagar_Receber.mp4",
        "title": "Contas a pagar e receber",
        "images": [SOURCE / "04-nova-conta.png", CAPTURES / "10-nova-conta.png"],
        "segments": [
            ("Localize os títulos", "Escolha entre contas a receber e contas a pagar. Depois filtre por status, pessoa, documento, vencimento ou outros campos avançados e clique em Buscar."),
            ("Crie uma nova conta", "Em Nova conta, informe empresa, cliente ou fornecedor, documento, parcela, datas, valor e forma prevista. Complete também a classificação nos níveis contábeis exibidos no formulário."),
            ("Execute as operações", "Selecione um ou mais títulos para quitar, criar acordo, cancelar uma baixa ou desfazer um acordo. Antes de confirmar, confira valores, datas, conta financeira e histórico."),
        ],
    },
    {
        "file": "04_Controle_de_Caixa.mp4",
        "title": "Controle de caixa",
        "image": SOURCE / "06-conciliacao.png",
        "segments": [
            ("Consulte os caixas", "No Controle de caixa, filtre por empresa, operador, terminal, situação e período para localizar rapidamente cada caixa."),
            ("Acompanhe os movimentos", "Veja abertura, entradas, saídas, saldo, horários e movimentações do caixa selecionado. Os indicadores ajudam a conferir o movimento antes do fechamento."),
            ("Abra, transfira e feche", "Use as ações disponíveis para abrir ou fechar o caixa e transferir valores. Sempre confira o destino, o valor informado e o resumo antes da confirmação."),
        ],
    },
    {
        "file": "05_Conciliacao.mp4",
        "title": "Conciliação financeira",
        "image": CAPTURES / "11-conciliacao.png",
        "segments": [
            ("Escolha o tipo", "Na Conciliação, alterne entre a conciliação bancária e a conciliação de cartão, conforme o arquivo que será conferido."),
            ("Importe e confira", "Na conciliação bancária, selecione o extrato OFX. Para cartão, utilize o arquivo CSV da adquirente. O sistema apresenta as correspondências encontradas antes do processamento."),
            ("Trate as pendências", "Revise os itens conciliados e os que ficaram sem correspondência. Use os filtros e detalhes para localizar diferenças antes de concluir qualquer ajuste."),
        ],
    },
    {
        "file": "06_DRE_Completo.mp4",
        "title": "DRE completo",
        "image": CAPTURES / "09-dre.png",
        "segments": [
            ("Defina a análise", "No DRE completo, selecione o intervalo de datas e escolha a visão por competência ou por vencimento."),
            ("Leia o demonstrativo", "O resultado do período aparece junto ao demonstrativo mensal. As linhas seguem a estrutura e as classificações cadastradas no Automec."),
            ("Ordene e exporte", "Clique nos títulos das colunas para ordenar os valores por descrição, mês ou total. Se precisar trabalhar os dados fora do sistema, utilize Exportar Excel."),
        ],
    },
    {
        "file": "07_Fechamento_de_Carteira.mp4",
        "title": "Fechamento de carteira",
        "image": SOURCE / "07-fechamento-carteira.png",
        "segments": [
            ("Selecione o período", "No Fechamento de carteira, informe as datas que deseja analisar e atualize a consulta."),
            ("Confira os clientes", "A tela organiza os valores por cliente e facilita a conferência da posição da carteira no período selecionado."),
            ("Valide os totais", "Compare os totais apresentados e use os detalhes para identificar diferenças antes de encerrar a conferência financeira."),
        ],
    },
    {
        "file": "08_Fiscal.mp4",
        "title": "Fiscal",
        "image": CAPTURES / "12-fiscal.png",
        "segments": [
            ("Consulte as notas", "Na área Fiscal, filtre as notas por texto, status, tipo e período. A grade mostra número, emissão, cliente, valor, situação e as ações disponíveis."),
            ("Use as ações fiscais", "De acordo com o status, você pode transmitir uma nota pendente, gerar o PDF, consultar a SEFAZ, emitir carta de correção ou iniciar um cancelamento."),
            ("Revise e feche", "As abas Revisão fiscal e Fechamento por CFOP ajudam a conferir classificações, divergências e valores antes do fechamento. Operações que alteram documentos devem ser confirmadas com atenção."),
        ],
    },
]


FONT_TITLE = ImageFont.truetype(r"C:\Windows\Fonts\segoeuib.ttf", 55)
FONT_SUBTITLE = ImageFont.truetype(r"C:\Windows\Fonts\segoeui.ttf", 34)
FONT_TAG = ImageFont.truetype(r"C:\Windows\Fonts\segoeuib.ttf", 25)


def wrap(draw, text, font, width):
    words, lines, line = text.split(), [], ""
    for word in words:
        candidate = f"{line} {word}".strip()
        if draw.textbbox((0, 0), candidate, font=font)[2] <= width:
            line = candidate
        else:
            lines.append(line)
            line = word
    if line:
        lines.append(line)
    return lines


def make_frame(source_path, title, heading, index, target):
    source = Image.open(source_path).convert("RGB")
    background = source.resize((1920, 1080)).filter(ImageFilter.GaussianBlur(28))
    background = ImageEnhance.Brightness(background).enhance(0.45).convert("RGBA")
    source.thumbnail((1760, 790), Image.Resampling.LANCZOS)
    x, y = (1920 - source.width) // 2, 42
    background.alpha_composite(source.convert("RGBA"), (x, y))
    draw = ImageDraw.Draw(background)
    draw.rounded_rectangle((58, 860, 1862, 1045), radius=28, fill=(7, 26, 52, 244), outline=(242, 101, 35, 255), width=4)
    draw.rounded_rectangle((88, 885, 150, 947), radius=18, fill=(242, 101, 35, 255))
    label = str(index)
    box = draw.textbbox((0, 0), label, font=FONT_TAG)
    draw.text((119 - (box[2] - box[0]) / 2, 916 - (box[3] - box[1]) / 2), label, font=FONT_TAG, fill="white")
    draw.text((178, 882), title, font=FONT_TITLE, fill="white")
    for row, line in enumerate(wrap(draw, heading, FONT_SUBTITLE, 920)[:2]):
        draw.text((870, 895 + row * 46), line, font=FONT_SUBTITLE, fill=(224, 236, 250, 255))
    background.convert("RGB").save(target, quality=95)


async def speak(text, target):
    communicate = edge_tts.Communicate(text, VOICE, rate="+12%", pitch="+4Hz", volume="+5%")
    await communicate.save(str(target))


def run(args):
    subprocess.run(args, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


async def build_video(number, video):
    folder = WORK / f"{number:02d}"
    folder.mkdir(parents=True, exist_ok=True)
    images = video["images"] if "images" in video else [video["image"]]
    clips = []
    for index, (heading, narration) in enumerate(video["segments"], 1):
        image_path = folder / f"frame-{index:02d}.jpg"
        audio_path = folder / f"audio-{index:02d}.mp3"
        clip_path = folder / f"clip-{index:02d}.mp4"
        source = images[min(index - 1, len(images) - 1)]
        make_frame(source, video["title"], heading, index, image_path)
        await speak(narration, audio_path)
        zoom = "zoompan=z='min(zoom+0.00045,1.055)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1920x1080:fps=30"
        run([FFMPEG, "-y", "-loop", "1", "-i", str(image_path), "-i", str(audio_path), "-vf", zoom,
             "-c:v", "libx264", "-preset", "medium", "-crf", "21", "-pix_fmt", "yuv420p",
             "-c:a", "aac", "-b:a", "160k", "-shortest", str(clip_path)])
        clips.append(clip_path)
    concat = folder / "concat.txt"
    concat.write_text("\n".join(f"file '{str(path).replace(chr(39), chr(39)*2)}'" for path in clips), encoding="utf-8")
    final = OUT / video["file"]
    run([FFMPEG, "-y", "-f", "concat", "-safe", "0", "-i", str(concat), "-c", "copy", "-movflags", "+faststart", str(final)])
    print(f"Criado: {final}")


async def main():
    OUT.mkdir(parents=True, exist_ok=True)
    WORK.mkdir(parents=True, exist_ok=True)
    for number, video in enumerate(VIDEOS, 1):
        await build_video(number, video)


if __name__ == "__main__":
    asyncio.run(main())
