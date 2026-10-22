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
DefaultDirName=C:\Administracao
DisableDirPage=no
DefaultGroupName={#AppName}
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\output\installer
#ifdef WithOllama
OutputBaseFilename=DashboardCliente-Setup-{#AppVersion}-Com-Ollama-ACBr
#else
OutputBaseFilename=DashboardCliente-Setup-{#AppVersion}
#endif
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern

[Dirs]
Name: "{sd}\Administracao\Dashboard"; Permissions: users-modify
Name: "{sd}\Administracao\Dashboard\logs"; Permissions: users-modify
Name: "{sd}\Administracao\Dashboard\certificados"; Permissions: users-modify
Name: "{sd}\Administracao\Dashboard\certificados_ct"; Permissions: users-modify
Name: "{sd}\Administracao\Dashboard\boletos_caixa"; Permissions: users-modify
Name: "{sd}\Administracao\Dashboard\boletos_caixa\pdf"; Permissions: users-modify
Name: "{sd}\Administracao\Dashboard\boletos_caixa\remessas"; Permissions: users-modify
Name: "{sd}\Administracao\Dashboard\acbr"; Permissions: users-modify
Name: "{sd}\Administracao\Dashboard\acbr\temporarios"; Permissions: users-modify
Name: "{sd}\ACBrMonitorPLUS"; Permissions: users-modify
Name: "{sd}\ACBrMonitorPLUS\Logs"; Permissions: users-modify
Name: "{sd}\ACBrMonitorPLUS\PDF"; Permissions: users-modify
Name: "{sd}\ACBrMonitorPLUS\Arqs"; Permissions: users-modify

[Files]
Source: "..\build\cliente-sem-fontes\runtime\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\build\cliente-sem-fontes\acbr\*"; DestDir: "{sd}\ACBrMonitorPLUS"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{commonappdata}\Dashboard\database_config.json"; DestDir: "{sd}\Administracao\Dashboard"; DestName: "start.ini"; Flags: external skipifsourcedoesntexist onlyifdoesntexist
Source: "..\database_config.example.json"; DestDir: "{sd}\Administracao\Dashboard"; DestName: "start.ini"; Flags: onlyifdoesntexist
Source: "..\credito_trabalhador_config.example.json"; DestDir: "{sd}\Administracao\Dashboard"; DestName: "credito_trabalhador_config.json"; Flags: onlyifdoesntexist
Source: "..\email_config.example.json"; DestDir: "{sd}\Administracao\Dashboard"; DestName: "email_config.json"; Flags: onlyifdoesntexist
Source: "..\nfe_sefaz_config.example.json"; DestDir: "{sd}\Administracao\Dashboard"; DestName: "nfe_sefaz_config.json"; Flags: onlyifdoesntexist
Source: "..\boletos_caixa_config.example.json"; DestDir: "{sd}\Administracao\Dashboard"; DestName: "boletos_caixa_config.json"; Flags: onlyifdoesntexist
Source: "..\cartao_depara.json"; DestDir: "{sd}\Administracao\Dashboard"; Flags: onlyifdoesntexist
#ifdef WithOllama
Source: "InstallOllama.ps1"; DestDir: "{tmp}"; Flags: deleteafterinstall
#endif

[Icons]
Name: "{group}\Abrir Dashboard"; Filename: "http://localhost:805"
Name: "{group}\Configuração do banco"; Filename: "notepad.exe"; Parameters: """{sd}\Administracao\Dashboard\start.ini"""
Name: "{group}\Configuração NF-e"; Filename: "notepad.exe"; Parameters: """{sd}\Administracao\Dashboard\nfe_sefaz_config.json"""
Name: "{group}\ACBr NF-e"; Filename: "{sd}\ACBrMonitorPLUS\ACBrMonitor64.exe"; WorkingDir: "{sd}\ACBrMonitorPLUS"
Name: "{commonstartup}\ACBrMonitorPLUS"; Filename: "{sd}\ACBrMonitorPLUS\ACBrMonitor64.exe"; WorkingDir: "{sd}\ACBrMonitorPLUS"
Name: "{group}\Configuração boleto CAIXA"; Filename: "notepad.exe"; Parameters: """{sd}\Administracao\Dashboard\boletos_caixa_config.json"""
Name: "{group}\Logs do serviço"; Filename: "{sd}\Administracao\Dashboard\logs"

[Run]
Filename: "{app}\DashboardService.exe"; Parameters: "install"; WorkingDir: "{app}"; StatusMsg: "Instalando serviço..."; Flags: runhidden waituntilterminated
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""Dashboard Gerencial 805"""; Flags: runhidden waituntilterminated
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall add rule name=""Dashboard Gerencial 805"" dir=in action=allow protocol=TCP localport=805"; Flags: runhidden waituntilterminated
Filename: "{app}\DashboardService.exe"; Parameters: "start"; WorkingDir: "{app}"; StatusMsg: "Iniciando serviço..."; Flags: runhidden waituntilterminated
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""ACBrMonitor NF-e 3434"""; Flags: runhidden waituntilterminated
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall add rule name=""ACBrMonitor NF-e 3434"" dir=in action=allow protocol=TCP localport=3434 remoteip=127.0.0.1"; Flags: runhidden waituntilterminated
Filename: "{sd}\ACBrMonitorPLUS\ACBrMonitor64.exe"; WorkingDir: "{sd}\ACBrMonitorPLUS"; StatusMsg: "Iniciando o ACBr para emissão de nota..."; Flags: nowait
#ifdef WithOllama
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{tmp}\InstallOllama.ps1"" -Step Install"; StatusMsg: "Etapa 1 de 2: instalando e iniciando o Ollama..."; Flags: waituntilterminated
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{tmp}\InstallOllama.ps1"" -Step Model"; StatusMsg: "Etapa 2 de 2: baixando e instalando o modelo qwen3:8b (aprox. 5,2 GB)..."; Flags: waituntilterminated
#endif

[UninstallRun]
Filename: "{app}\DashboardService.exe"; Parameters: "stop"; WorkingDir: "{app}"; Flags: runhidden waituntilterminated; RunOnceId: StopService
Filename: "{app}\DashboardService.exe"; Parameters: "uninstall"; WorkingDir: "{app}"; Flags: runhidden waituntilterminated; RunOnceId: RemoveService

[Code]
var
  DatabasePage: TWizardPage;
  HostEdit, PortEdit, DatabaseEdit, UserEdit, PasswordEdit: TNewEdit;
  AmbienteProducao, AmbienteHomologacao: TNewRadioButton;

function JsonEscape(Value: String): String;
begin
  StringChangeEx(Value, '\', '\\', True);
  StringChangeEx(Value, '"', '\"', True);
  Result := Value;
end;

function PosFrom(SubString, Value: String; StartAt: Integer): Integer;
var
  RelativePos: Integer;
begin
  RelativePos := Pos(SubString, Copy(Value, StartAt, MaxInt));
  if RelativePos = 0 then
    Result := 0
  else
    Result := StartAt + RelativePos - 1;
end;

function JsonStringValue(Json, Key, DefaultValue: String): String;
var
  KeyPos, ColonPos, StartPos, EndPos: Integer;
begin
  Result := DefaultValue;
  KeyPos := Pos('"' + Key + '"', Json);
  if KeyPos = 0 then Exit;
  ColonPos := PosFrom(':', Json, KeyPos);
  if ColonPos = 0 then Exit;
  StartPos := PosFrom('"', Json, ColonPos + 1);
  if StartPos = 0 then Exit;
  EndPos := PosFrom('"', Json, StartPos + 1);
  if EndPos = 0 then Exit;
  Result := Copy(Json, StartPos + 1, EndPos - StartPos - 1);
  StringChangeEx(Result, '\\', '\', True);
end;

function JsonNumberValue(Json, Key, DefaultValue: String): String;
var
  KeyPos, ColonPos, I: Integer;
begin
  Result := DefaultValue;
  KeyPos := Pos('"' + Key + '"', Json);
  if KeyPos = 0 then Exit;
  ColonPos := PosFrom(':', Json, KeyPos);
  if ColonPos = 0 then Exit;
  I := ColonPos + 1;
  while (I <= Length(Json)) and (Json[I] = ' ') do I := I + 1;
  Result := '';
  while (I <= Length(Json)) and (Json[I] >= '0') and (Json[I] <= '9') do
  begin
    Result := Result + Json[I];
    I := I + 1;
  end;
  if Result = '' then Result := DefaultValue;
end;

function SetJsonStringValue(Content, Key, Value: String): String;
var
  KeyPos, ColonPos, StartPos, EndPos, Brace: Integer;
begin
  KeyPos := Pos('"' + Key + '"', Content);
  if KeyPos = 0 then
  begin
    Brace := Length(Content);
    while (Brace > 0) and (Content[Brace] <> '}') do Brace := Brace - 1;
    if Brace = 0 then
      Result := Content
    else
      Result := Copy(Content, 1, Brace - 1) + '  "' + Key + '": "' + Value + '"' + #13#10 + Copy(Content, Brace, MaxInt);
    Exit;
  end;
  ColonPos := PosFrom(':', Content, KeyPos);
  StartPos := PosFrom('"', Content, ColonPos + 1);
  EndPos := PosFrom('"', Content, StartPos + 1);
  if (StartPos = 0) or (EndPos = 0) then
  begin
    Result := Content;
    Exit;
  end;
  Result := Copy(Content, 1, StartPos) + Value + Copy(Content, EndPos, MaxInt);
end;

function AddLabeledEdit(Page: TWizardPage; Caption: String; Top, LabelWidth: Integer; Password: Boolean): TNewEdit;
var
  Lbl: TNewStaticText;
begin
  Lbl := TNewStaticText.Create(Page);
  Lbl.Parent := Page.Surface;
  Lbl.Caption := Caption;
  Lbl.Left := 0;
  Lbl.Top := Top + ScaleY(3);
  Lbl.AutoSize := False;
  Lbl.Width := LabelWidth;
  Lbl.Height := ScaleY(18);

  Result := TNewEdit.Create(Page);
  Result.Parent := Page.Surface;
  Result.Left := LabelWidth + ScaleX(8);
  Result.Top := Top;
  Result.Width := Page.SurfaceWidth - Result.Left;
  if Password then Result.PasswordChar := '*';
end;

procedure AjustarCamposBanco(Sender: TWizardPage);
var
  Largura: Integer;
begin
  Largura := DatabasePage.SurfaceWidth - HostEdit.Left;
  if Largura < ScaleX(80) then Exit;
  HostEdit.Width := Largura;
  PortEdit.Width := Largura;
  DatabaseEdit.Width := Largura;
  UserEdit.Width := Largura;
  PasswordEdit.Width := Largura;
end;

procedure InitializeWizard;
var
  ExistingConfig, NfeConfig: AnsiString;
  ConfigPath, NfePath, AmbienteAtual: String;
  LabelWidth, TopPos: Integer;
  AmbienteLabel: TNewStaticText;
begin
  DatabasePage := CreateCustomPage(wpSelectDir,
    'Conexão com o banco de dados',
    'Em uma máquina cliente, informe o nome ou IP do servidor. Não use localhost, exceto quando o Firebird estiver nesta mesma máquina.');
  DatabasePage.OnActivate := @AjustarCamposBanco;

  LabelWidth := ScaleX(210);
  TopPos := 0;
  HostEdit := AddLabeledEdit(DatabasePage, 'Servidor ou endereço IP:', TopPos, LabelWidth, False);
  TopPos := TopPos + ScaleY(28);
  PortEdit := AddLabeledEdit(DatabasePage, 'Porta do Firebird:', TopPos, LabelWidth, False);
  TopPos := TopPos + ScaleY(28);
  DatabaseEdit := AddLabeledEdit(DatabasePage, 'Caminho do banco no servidor:', TopPos, LabelWidth, False);
  TopPos := TopPos + ScaleY(28);
  UserEdit := AddLabeledEdit(DatabasePage, 'Usuário:', TopPos, LabelWidth, False);
  TopPos := TopPos + ScaleY(28);
  PasswordEdit := AddLabeledEdit(DatabasePage, 'Senha:', TopPos, LabelWidth, True);

  HostEdit.Text := 'localhost';
  PortEdit.Text := '3051';
  DatabaseEdit.Text := 'C:\Administracao\db\MIAUTOMEC.FDB';
  UserEdit.Text := 'SYSDBA';
  PasswordEdit.Text := 'masterkey';

  ConfigPath := ExpandConstant('{sd}\Administracao\Dashboard\start.ini');
  if LoadStringFromFile(ConfigPath, ExistingConfig) then
  begin
    HostEdit.Text := JsonStringValue(String(ExistingConfig), 'host', HostEdit.Text);
    PortEdit.Text := JsonNumberValue(String(ExistingConfig), 'port', PortEdit.Text);
    DatabaseEdit.Text := JsonStringValue(String(ExistingConfig), 'database', DatabaseEdit.Text);
    UserEdit.Text := JsonStringValue(String(ExistingConfig), 'user', UserEdit.Text);
    PasswordEdit.Text := JsonStringValue(String(ExistingConfig), 'password', PasswordEdit.Text);
  end;

  TopPos := TopPos + ScaleY(36);
  AmbienteLabel := TNewStaticText.Create(DatabasePage);
  AmbienteLabel.Parent := DatabasePage.Surface;
  AmbienteLabel.Caption := 'Ambiente da NF-e:';
  AmbienteLabel.Left := 0;
  AmbienteLabel.Top := TopPos;
  AmbienteLabel.AutoSize := True;

  TopPos := TopPos + ScaleY(20);
  AmbienteProducao := TNewRadioButton.Create(DatabasePage);
  AmbienteProducao.Parent := DatabasePage.Surface;
  AmbienteProducao.Caption := 'Produção';
  AmbienteProducao.Left := 0;
  AmbienteProducao.Top := TopPos;
  AmbienteProducao.Width := ScaleX(120);
  AmbienteProducao.Height := ScaleY(17);
  AmbienteProducao.Checked := True;

  AmbienteHomologacao := TNewRadioButton.Create(DatabasePage);
  AmbienteHomologacao.Parent := DatabasePage.Surface;
  AmbienteHomologacao.Caption := 'Homologação';
  AmbienteHomologacao.Left := ScaleX(140);
  AmbienteHomologacao.Top := TopPos;
  AmbienteHomologacao.Width := ScaleX(150);
  AmbienteHomologacao.Height := ScaleY(17);

  NfePath := ExpandConstant('{sd}\Administracao\Dashboard\nfe_sefaz_config.json');
  if LoadStringFromFile(NfePath, NfeConfig) then
  begin
    AmbienteAtual := JsonStringValue(String(NfeConfig), 'ambiente', 'producao');
    if AmbienteAtual = 'homologacao' then
      AmbienteHomologacao.Checked := True
    else
      AmbienteProducao.Checked := True;
  end;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  PortNumber: Integer;
begin
  Result := True;
  if CurPageID <> DatabasePage.ID then Exit;

  if Trim(HostEdit.Text) = '' then
  begin
    MsgBox('Informe o nome ou endereço IP do servidor Firebird.', mbError, MB_OK);
    Result := False;
  end;
  PortNumber := StrToIntDef(Trim(PortEdit.Text), -1);
  if Result and ((PortNumber < 1) or (PortNumber > 65535)) then
  begin
    MsgBox('Informe uma porta válida entre 1 e 65535.', mbError, MB_OK);
    Result := False;
  end;
  if Result and (Trim(DatabaseEdit.Text) = '') then
  begin
    MsgBox('Informe o caminho completo do arquivo do banco no servidor.', mbError, MB_OK);
    Result := False;
  end;
  if Result and (Trim(UserEdit.Text) = '') then
  begin
    MsgBox('Informe o usuário do Firebird.', mbError, MB_OK);
    Result := False;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Config, ConfigPath, NfePath, NfeText, AmbienteNome, AcbrIni: String;
  NfeRaw: AnsiString;
  AcbrAmbiente, ResultCode: Integer;
begin
  if CurStep <> ssPostInstall then Exit;

  ConfigPath := ExpandConstant('{sd}\Administracao\Dashboard\start.ini');
  Config := '{' + #13#10 +
    '  "type": "firebird",' + #13#10 +
    '  "name": "Banco principal",' + #13#10 +
    '  "host": "' + JsonEscape(Trim(HostEdit.Text)) + '",' + #13#10 +
    '  "port": ' + Trim(PortEdit.Text) + ',' + #13#10 +
    '  "database": "' + JsonEscape(Trim(DatabaseEdit.Text)) + '",' + #13#10 +
    '  "user": "' + JsonEscape(Trim(UserEdit.Text)) + '",' + #13#10 +
    '  "password": "' + JsonEscape(PasswordEdit.Text) + '",' + #13#10 +
    '  "charset": "WIN1252",' + #13#10 +
    '  "role": "",' + #13#10 +
    '  "active": true' + #13#10 +
    '}' + #13#10;

  if not SaveStringToFile(ConfigPath, Config, False) then
    MsgBox('Não foi possível salvar a configuração do banco em ' + ConfigPath + '.', mbError, MB_OK);

  if AmbienteHomologacao.Checked then
  begin
    AmbienteNome := 'homologacao';
    AcbrAmbiente := 1;
  end
  else
  begin
    AmbienteNome := 'producao';
    AcbrAmbiente := 0;
  end;

  NfePath := ExpandConstant('{sd}\Administracao\Dashboard\nfe_sefaz_config.json');
  if LoadStringFromFile(NfePath, NfeRaw) then
  begin
    NfeText := SetJsonStringValue(String(NfeRaw), 'ambiente', AmbienteNome);
    if not SaveStringToFile(NfePath, NfeText, False) then
      MsgBox('Não foi possível salvar o ambiente da NF-e em ' + NfePath + '.', mbError, MB_OK);
  end
  else
    MsgBox('Não foi possível abrir ' + NfePath + ' para definir o ambiente da NF-e.', mbError, MB_OK);

  Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /IM ACBrMonitor64.exe', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  AcbrIni := ExpandConstant('{sd}\ACBrMonitorPLUS\ACBrMonitor.ini');
  if FileExists(AcbrIni) then
  begin
    if not SetIniInt('WebService', 'Ambiente', AcbrAmbiente, AcbrIni) then
      MsgBox('Não foi possível gravar o ambiente da NF-e no ACBr.', mbError, MB_OK);
  end;
end;

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
  if RegKeyExists(HKLM, 'SYSTEM\CurrentControlSet\Services\{#ServiceName}') then
  begin
    Exec(ExpandConstant('{sys}\sc.exe'), 'stop {#ServiceName}', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    Exec(ExpandConstant('{sys}\sc.exe'), 'delete {#ServiceName}', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  end;
  Result := '';
end;
