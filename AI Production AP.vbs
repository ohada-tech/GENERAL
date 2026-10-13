' ============================================================
'  AI Production AP - one-click launcher (Windows)
'  Double-click: starts the server in the background (no window)
'  and opens the app in your browser. If it's already running,
'  it just opens the browser. Creates a desktop shortcut too.
'  Run with /shortcut to only (re)create the desktop shortcut.
' ============================================================
Option Explicit
Dim sh, fso, dir, url, i
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir
url = "http://127.0.0.1:3001"

Sub MakeShortcut()
  Dim lnk, path
  path = sh.SpecialFolders("Desktop") & "\AI Production AP.lnk"
  Set lnk = sh.CreateShortcut(path)
  lnk.TargetPath = "wscript.exe"
  lnk.Arguments = """" & WScript.ScriptFullName & """"
  lnk.WorkingDirectory = dir
  lnk.IconLocation = dir & "\assets\app.ico"
  lnk.Description = "AI Production AP"
  lnk.Save
End Sub

Function ServerUp()
  Dim http
  ServerUp = False
  On Error Resume Next
  Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
  http.setTimeouts 1000, 1000, 1000, 1000
  http.Open "GET", url & "/api/health", False
  http.Send
  If Err.Number = 0 Then
    If http.Status = 200 Then ServerUp = True
  End If
  Err.Clear
  On Error GoTo 0
End Function

If WScript.Arguments.Count > 0 Then
  If LCase(WScript.Arguments(0)) = "/shortcut" Then
    MakeShortcut
    WScript.Quit
  End If
End If

MakeShortcut

' Already running -> just open the browser
If ServerUp() Then
  sh.Run url
  WScript.Quit
End If

' Node.js installed?
If sh.Run("cmd /c where node >nul 2>nul", 0, True) <> 0 Then
  MsgBox "Node.js is not installed." & vbCrLf & "Install the LTS version from nodejs.org and try again.", vbExclamation, "AI Production AP"
  sh.Run "https://nodejs.org"
  WScript.Quit
End If

' First run (no dependencies yet) -> visible installer window
If Not fso.FolderExists(dir & "\node_modules") Then
  MsgBox "First run: installing (1-2 minutes)." & vbCrLf & "A window will open - keep it open. Next time just double-click the desktop icon.", vbInformation, "AI Production AP"
  sh.Run "cmd /c start-windows.bat", 1, False
  WScript.Quit
End If

' Normal run -> build + start hidden, log to data\server.log
If Not fso.FolderExists(dir & "\data") Then fso.CreateFolder(dir & "\data")
sh.Run "cmd /c npm run build > data\server.log 2>&1 && npm start >> data\server.log 2>&1", 0, False

For i = 1 To 120
  WScript.Sleep 1000
  If ServerUp() Then
    sh.Run url
    WScript.Quit
  End If
Next

MsgBox "The server did not start." & vbCrLf & "Details: " & dir & "\data\server.log", vbCritical, "AI Production AP"
sh.Run "notepad """ & dir & "\data\server.log"""
