' ---------------------------------------------------------------
'  Seventh World - silent launcher for start-server.bat
'  Runs the batch with a hidden window (no console pop-up on logon).
' --------------------------------------------------------------
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
rootDir = fso.GetParentFolderName(scriptDir)

sh.CurrentDirectory = rootDir
sh.Run """" & scriptDir & "\start-server.bat""", 0, False
