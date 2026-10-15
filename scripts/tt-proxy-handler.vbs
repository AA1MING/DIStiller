' TT local data proxy - hidden launcher
' Invoked by the registered custom protocol "tt-proxy://" or by the Run key
' auto-start entry. It starts scripts\tt-local-proxy.mjs with no console
' window and returns immediately.
Option Explicit
Dim fso, shell, scriptDir, candidates, nodePath, i
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

candidates = Array( _
  shell.ExpandEnvironmentStrings("%ProgramFiles%\nodejs\node.exe"), _
  shell.ExpandEnvironmentStrings("%ProgramFiles(x86)%\nodejs\node.exe"), _
  shell.ExpandEnvironmentStrings("%LocalAppData%\Programs\nodejs\node.exe") _
)
nodePath = ""
For i = 0 To UBound(candidates)
  If fso.FileExists(candidates(i)) Then
    nodePath = candidates(i)
    Exit For
  End If
Next
If nodePath = "" Then
  nodePath = "node"
End If

shell.Run """" & nodePath & """ """ & scriptDir & "\tt-local-proxy.mjs""", 0, False