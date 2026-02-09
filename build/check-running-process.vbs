On Error Resume Next
Set objWMIService = GetObject("winmgmts:\\.\root\cimv2")
Set colProcesses = objWMIService.ExecQuery("Select * from Win32_Process Where Name = 'SIP Toast.exe'")

If colProcesses.Count > 0 Then
  result = MsgBox("SIP Toast is currently running." & vbCrLf & vbCrLf & "Please close the application before continuing with the update." & vbCrLf & vbCrLf & "Click OK to close SIP Toast automatically, or Cancel to abort the installation.", vbOKCancel + vbExclamation, "SIP Toast Installation")
  
  If result = vbOK Then
    ' Try to close the application
    For Each objProcess in colProcesses
      objProcess.Terminate()
    Next
    
    ' Wait for the process to close
    WScript.Sleep(2000)
    
    ' Check again if it's still running
    Set colProcesses = objWMIService.ExecQuery("Select * from Win32_Process Where Name = 'SIP Toast.exe'")
    If colProcesses.Count > 0 Then
      MsgBox "SIP Toast could not be closed automatically." & vbCrLf & "Please close it manually and try again.", vbCritical, "SIP Toast Installation"
      WScript.Quit(1)
    End If
  Else
    MsgBox "Installation cancelled. Please close SIP Toast and run the installer again.", vbInformation, "SIP Toast Installation"
    WScript.Quit(1)
  End If
End If

