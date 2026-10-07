import { Node } from "./Node";
export { Node };

/**
 * Doubly linked list with a playback pointer (current).
 * The core logic does NOT use native arrays: only nodes and pointers.
 */
export class DoublyLinkedList<T> {
  head: Node<T> | null = null;    // First node
  tail: Node<T> | null = null;    // Last node
  current: Node<T> | null = null; // Current song
  private _size = 0;

  get size(): number { return this._size; }

  /** Inserts at the start. O(1) */
  addFirst(data: T): Node<T> {
    const n = new Node(data);
    if (!this.head) this.head = this.tail = n;
    else { n.next = this.head; this.head.prev = n; this.head = n; }
    return this.afterInsert(n);
  }

  /** Inserts at the end. O(1) */
  addLast(data: T): Node<T> {
    const n = new Node(data);
    if (!this.tail) this.head = this.tail = n;
    else { n.prev = this.tail; this.tail.next = n; this.tail = n; }
    return this.afterInsert(n);
  }

  /** Inserts at the given index (<=0 start, >=size end). */
  insertAt(index: number, data: T): Node<T> {
    if (index <= 0 || !this.head) return this.addFirst(data);
    if (index >= this._size) return this.addLast(data);
    const target = this.nodeAt(index)!;          // will end up right after the new node
    const n = new Node(data);
    n.prev = target.prev; n.next = target;
    target.prev!.next = n; target.prev = n;
    return this.afterInsert(n);
  }

  private afterInsert(n: Node<T>): Node<T> {
    this._size++;
    if (!this.current) this.current = n; // the first song becomes the current one
    return n;
  }

  /** Finds a node by index, walking from the nearest end. */
  nodeAt(index: number): Node<T> | null {
    if (index < 0 || index >= this._size) return null;
    let node: Node<T>;
    if (index < this._size / 2) { node = this.head!; for (let i = 0; i < index; i++) node = node.next!; }
    else { node = this.tail!; for (let i = this._size - 1; i > index; i--) node = node.prev!; }
    return node;
  }

  /** Removes a node, readjusting the next/prev pointers of its neighbours. */
  remove(node: Node<T>): void {
    if (node.prev) node.prev.next = node.next; else this.head = node.next;
    if (node.next) node.next.prev = node.prev; else this.tail = node.prev;
    if (this.current === node) this.current = node.next ?? node.prev; // moves to the next song (or the previous one if it was the last)
    node.next = node.prev = null;
    this._size--;
  }

  removeAt(index: number): boolean {
    const n = this.nodeAt(index);
    if (!n) return false;
    this.remove(n);
    return true;
  }

  /** Skip forward: current advances to the next node (false if it is already the last). */
  moveNext(): boolean { if (!this.current?.next) return false; this.current = this.current.next; return true; }

  /** Go back: current returns to the previous node (false if it is already the first). */
  movePrev(): boolean { if (!this.current?.prev) return false; this.current = this.current.prev; return true; }

  /** Shuffles by relinking the same nodes (current does not change). */
  shuffle(): void {
    let remaining = this.head, left = this._size;
    let newHead: Node<T> | null = null, newTail: Node<T> | null = null;
    while (left > 0) {
      let pick = remaining!;
      for (let k = Math.floor(Math.random() * left); k > 0; k--) pick = pick.next!;
      // 1) detach it from the remaining nodes
      if (pick.prev) pick.prev.next = pick.next; else remaining = pick.next;
      if (pick.next) pick.next.prev = pick.prev;
      // 2) append it to the end of the new chain
      pick.prev = newTail; pick.next = null;
      if (newTail) newTail.next = pick; else newHead = pick;
      newTail = pick; left--;
    }
    this.head = newHead; this.tail = newTail;
  }

  /**
   * Reorder: moves `node` right before `ref` (null = to the end) by relinking pointers.
   * Does not change the size or the current song (current keeps pointing to the same node).
   */
  moveBefore(node: Node<T>, ref: Node<T> | null): void {
    if (node === ref || node.next === ref) return;           // already in that position
    // 1) detach from its current place
    if (node.prev) node.prev.next = node.next; else this.head = node.next;
    if (node.next) node.next.prev = node.prev; else this.tail = node.prev;
    // 2) attach before ref (or at the end)
    if (ref === null) {
      node.prev = this.tail; node.next = null;
      this.tail!.next = node; this.tail = node;
    } else {
      node.next = ref; node.prev = ref.prev;
      if (ref.prev) ref.prev.next = node; else this.head = node;
      ref.prev = node;
    }
  }

  /** Iterates from head to tail. */
  forEach(cb: (data: T, index: number, node: Node<T>) => void): void {
    let i = 0;
    for (let n = this.head; n; n = n.next) cb(n.data, i++, n);
  }
}
