#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#define AppName "Dashboard Gerencial"
#define ServiceName "SrvDashboard"
#define OldServiceName "BocadoMatoDashboard"

[Setup]
AppId={{7BE9E2DD-E4FD-4A66-B5E7-432D4979EB67}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=Dashboard
DefaultDirName={autopf}\Dashboard
DefaultGroupName={#AppName}
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\output\installer
#ifdef WithOllama
OutputBaseFilename=DashboardCliente-Setup-{#AppVersion}-Com-Ollama
#else
OutputBaseFilename=DashboardCliente-Setup-{#AppVersion}
#endif
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern

[Dirs]
Name: "{commonappdata}\Dashboard"; Permissions: users-modify
Name: "{commonappdata}\Dashboard\logs"; Permissions: users-modify
Name: "{commonappdata}\Dashboard\certificados"; Permissions: users-modify
Name: "{commonappdata}\Dashboard\certificados_ct"; Permissions: users-modify
Name: "{commonappdata}\Dashboard\boletos_caixa"; Permissions: users-modify
Name: "{commonappdata}\Dashboard\boletos_caixa\pdf"; Permissions: users-modify
Name: "{commonappdata}\Dashboard\boletos_caixa\remessas"; Permissions: users-modify

[Files]
Source: "..\build\cliente-sem-fontes\runtime\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\database_config.example.json"; DestDir: "{commonappdata}\Dashboard"; DestName: "database_config.json"; Flags: onlyifdoesntexist
Source: "..\credito_trabalhador_config.example.json"; DestDir: "{commonappdata}\Dashboard"; DestName: "credito_trabalhador_config.json"; Flags: onlyifdoesntexist
Source: "..\email_config.example.json"; DestDir: "{commonappdata}\Dashboard"; DestName: "email_config.json"; Flags: onlyifdoesntexist
Source: "..\nfe_sefaz_config.example.json"; DestDir: "{commonappdata}\Dashboard"; DestName: "nfe_sefaz_config.json"; Flags: onlyifdoesntexist
Source: "..\boletos_caixa_config.example.json"; DestDir: "{commonappdata}\Dashboard"; DestName: "boletos_caixa_config.json"; Flags: onlyifdoesntexist
Source: "..\cartao_depara.json"; DestDir: "{commonappdata}\Dashboard"; Flags: onlyifdoesntexist

[Icons]
Name: "{group}\Abrir Dashboard"; Filename: "http://localhost:805"
Name: "{group}\Configuração do banco"; Filename: "notepad.exe"; Parameters: """{commonappdata}\Dashboard\database_config.json"""
Name: "{group}\Configuração NF-e"; Filename: "notepad.exe"; Parameters: """{commonappdata}\Dashboard\nfe_sefaz_config.json"""
Name: "{group}\Configuração boleto CAIXA"; Filename: "notepad.exe"; Parameters: """{commonappdata}\Dashboard\boletos_caixa_config.json"""
Name: "{group}\Logs do serviço"; Filename: "{commonappdata}\Dashboard\logs"

[Run]
Filename: "{sys}\sc.exe"; Parameters: "create {#ServiceName} start= auto DisplayName= ""Dashboard Gerencial"" binPath= """"{app}\DashboardNode.exe"" ""{app}\node-app\server\dashboard.mjs"""""; StatusMsg: "Instalando serviço..."; Flags: runhidden waituntilterminated; Check: InstallNewService
Filename: "{sys}\sc.exe"; Parameters: "config {#ServiceName} start= auto binPath= """"{app}\DashboardNode.exe"" ""{app}\node-app\server\dashboard.mjs"""""; StatusMsg: "Atualizando serviço..."; Flags: runhidden waituntilterminated; Check: UpdateExistingService
Filename: "{sys}\sc.exe"; Parameters: "failure {#ServiceName} reset= 86400 actions= restart/5000/restart/5000/restart/30000"; Flags: runhidden waituntilterminated
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""Dashboard Gerencial 805"""; Flags: runhidden waituntilterminated
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall add rule name=""Dashboard Gerencial 805"" dir=in action=allow protocol=TCP localport=805"; Flags: runhidden waituntilterminated
Filename: "{sys}\sc.exe"; Parameters: "start {#ServiceName}"; StatusMsg: "Iniciando serviço..."; Flags: runhidden waituntilterminated
#ifdef WithOllama
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""if (-not (Test-Path (Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'))) {{ irm https://ollama.com/install.ps1 | iex }}"""; StatusMsg: "Instalando o Ollama oficial..."; Flags: runhidden waituntilterminated
Filename: "{localappdata}\Programs\Ollama\ollama.exe"; Parameters: "pull qwen3:8b"; StatusMsg: "Baixando o modelo qwen3:8b (aproximadamente 5,2 GB)..."; Flags: runhidden waituntilterminated; Check: OllamaInstalled
#endif

[UninstallRun]
Filename: "{sys}\sc.exe"; Parameters: "stop {#ServiceName}"; Flags: runhidden waituntilterminated; RunOnceId: StopService
Filename: "{sys}\sc.exe"; Parameters: "delete {#ServiceName}"; Flags: runhidden waituntilterminated; RunOnceId: RemoveService

[Code]
var
  ServiceWasInstalled: Boolean;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  { Remove somente o servico antigo da aplicacao. Nao altera servicos Firebird. }
  if RegKeyExists(HKLM, 'SYSTEM\CurrentControlSet\Services\{#OldServiceName}') then
  begin
    Exec(ExpandConstant('{sys}\sc.exe'), 'stop {#OldServiceName}', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    Exec(ExpandConstant('{sys}\sc.exe'), 'delete {#OldServiceName}', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  end;
  ServiceWasInstalled := RegKeyExists(HKLM, 'SYSTEM\CurrentControlSet\Services\{#ServiceName}');
  if ServiceWasInstalled then
    Exec(ExpandConstant('{sys}\sc.exe'), 'stop {#ServiceName}', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Result := '';
end;

function InstallNewService(): Boolean;
begin
  Result := not ServiceWasInstalled;
end;

function UpdateExistingService(): Boolean;
begin
  Result := ServiceWasInstalled;
end;

function OllamaInstalled(): Boolean;
begin
  Result := FileExists(ExpandConstant('{localappdata}\Programs\Ollama\ollama.exe'));
end;
