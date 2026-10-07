/** Generic node of the doubly linked list. */
export class Node<T> {
  next: Node<T> | null = null; // Next node
  prev: Node<T> | null = null; // Previous node
  constructor(public data: T) {}
}
