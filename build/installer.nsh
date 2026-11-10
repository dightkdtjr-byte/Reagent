; 이전 설치본이 만든 바로가기를 새 설치본의 바로가기로 바꾼다.
!macro customInit
  Delete "$DESKTOP\ReagentInventory.lnk"
  Delete "$DESKTOP\시약 재고관리 시스템.lnk"
  Delete "$SMPROGRAMS\ReagentInventory.lnk"
  Delete "$SMPROGRAMS\시약 재고관리 시스템.lnk"
!macroend
