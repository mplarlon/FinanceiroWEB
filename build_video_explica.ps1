$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$out = Join-Path $root "output\video-explicativo"
$python = "C:\Users\Carol\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
$env:PYTHONPATH = Join-Path $root "build\video-python"
$ffmpeg = & $python -c "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())"

& $python (Join-Path $root "build_video_explica.py")

Add-Type -AssemblyName System.Speech
$voice = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voice.SelectVoice("Microsoft Maria Desktop")
$voice.Rate = -1
$texts = @(
    "Este é o Charlie, o assistente financeiro. Faça perguntas do seu jeito sobre contas, vencimentos, fornecedores, clientes, bancos e caixa.",
    "Na visão geral, acompanhe os principais indicadores da operação e identifique rapidamente os pontos que exigem atenção.",
    "Em contas a pagar e receber, filtre títulos, consulte vencimentos e execute quitações, acordos e cancelamentos.",
    "Para criar um lançamento, informe empresa, cliente ou fornecedor, documento, vencimento, valor e forma prevista. A classificação contábil também pode ser preenchida.",
    "No controle de caixa, abra e feche caixas, transfira valores e acompanhe entradas, saídas, saldo e horários de maior movimento.",
    "Na conciliação financeira, importe extratos OFX, confira correspondências e trate os itens que ainda precisam ser conciliados.",
    "O fechamento de carteira permite consultar o período desejado e conferir os valores organizados por cliente.",
    "No módulo fiscal, consulte notas, acompanhe seus status e acesse a revisão fiscal e o fechamento por CFOP. Os relatórios não fazem parte deste vídeo."
)

$clips = @()
for ($i = 1; $i -le $texts.Count; $i++) {
    $wav = Join-Path $out ("audio-{0:D2}.wav" -f $i)
    $mp4 = Join-Path $out ("clip-{0:D2}.mp4" -f $i)
    $image = Join-Path $out ("frame-{0:D2}.jpg" -f $i)
    $voice.SetOutputToWaveFile($wav)
    $voice.Speak($texts[$i - 1])
    $voice.SetOutputToNull()
    & $ffmpeg -y -loop 1 -i $image -i $wav -c:v libx264 -tune stillimage -pix_fmt yuv420p -r 30 -c:a aac -b:a 160k -shortest $mp4 | Out-Null
    $clips += $mp4
}
$voice.Dispose()

$concat = Join-Path $out "concat.txt"
$clips | ForEach-Object { "file '$($_.Replace("'", "''"))'" } | Set-Content $concat -Encoding utf8
$final = Join-Path $out "Video_Explicativo_Dashboard.mp4"
& $ffmpeg -y -f concat -safe 0 -i $concat -c copy $final | Out-Null
Write-Host "Video criado: $final"
