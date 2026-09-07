// 물품명+단위로 재고 항목을 구분하는 키. 같은 이름이라도 단위가 다르면 다른 물품으로 본다.
export function stockKey(itemName, unit) {
  return `${itemName}||${unit ?? ''}`
}
