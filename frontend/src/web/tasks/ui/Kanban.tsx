import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  pointerWithin,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { cn } from "cn";
import { useState, type ReactNode } from "react";
import { GlyphIcon, type Glyph } from "./Glyph";
import { place, sortByOrder, type DropTarget } from "./order";

const CARD = "card:";

const underPointer: CollisionDetection = args => {
  const hits = pointerWithin(args);
  const cards = hits.filter(h => String(h.id).startsWith(CARD));
  return cards.length > 0 ? cards : hits.length > 0 ? hits : closestCenter(args);
};

export type KanbanColumn<C extends string> = {
  id: C;
  label: string;
  glyph: Glyph;
  total?: number;
  droppable?: boolean;
};

export type KanbanOrder<T> = {
  keys: readonly string[];
  rankOf: (item: T) => string;
  save: (keys: string[]) => void;
};

type KanbanProps<C extends string, T> = {
  label: string;
  columns: readonly KanbanColumn<C>[];
  items: readonly T[];
  keyOf: (item: T) => string;
  columnOf: (item: T) => C;
  renderCard: (item: T) => ReactNode;
  glyphOf: (item: T) => Glyph;
  onMove: (item: T, to: C) => void;
  canDrop?: (item: T, to: C) => boolean;
  order?: KanbanOrder<T>;
  selected: string | null;
  onSelect: (key: string) => void;
  footer?: Partial<Record<C, ReactNode>>;
};

type Over<C extends string> = { column: C; card: DropTarget | null };
type DragAt = Pick<DragEndEvent, "active" | "over">;

const sameOver = <C extends string>(a: Over<C> | null, b: Over<C> | null) => a?.column === b?.column && a?.card?.key === b?.card?.key && a?.card?.after === b?.card?.after;

export function Kanban<C extends string, T>(p: KanbanProps<C, T>) {
  const [active, setActive] = useState<T | null>(null);
  const [over, setOver] = useState<Over<C> | null>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space"] } }),
  );

  const items = p.order ? sortByOrder(p.items, p.order.rankOf, p.order.keys) : p.items;
  const find = (key: string | number) => items.find(i => p.keyOf(i) === String(key)) ?? null;
  const accepts = (col: KanbanColumn<C>, item: T | null) => col.droppable !== false && (item === null || (p.canDrop?.(item, col.id) ?? true));

  const overOf = ({ active: a, over: o }: DragAt): Over<C> | null => {
    if (!o) return null;
    const id = String(o.id);
    if (!id.startsWith(CARD)) {
      const col = p.columns.find(c => c.id === id);
      return col ? { column: col.id, card: null } : null;
    }
    const key = id.slice(CARD.length);
    const item = find(key);
    if (!item) return null;
    const dragged = a.rect.current.translated;
    const middle = o.rect.top + o.rect.height / 2;
    return { column: p.columnOf(item), card: { key, after: dragged ? dragged.top + dragged.height / 2 > middle : false } };
  };

  const reorder = (order: KanbanOrder<T>, item: T, drop: Over<C>, moved: boolean) => {
    if (drop.card?.key === p.keyOf(item) || (!moved && !drop.card)) return;
    const onto = drop.card ? find(drop.card.key) : (items.filter(i => i !== item && p.columnOf(i) === drop.column).at(-1) ?? null);
    const target = onto ? { key: order.rankOf(onto), after: drop.card?.after ?? true } : null;
    const next = place(order.keys, items.map(order.rankOf), order.rankOf(item), target);
    if (next.join("\n") !== order.keys.join("\n")) order.save(next);
  };

  const track = (e: DragAt) => {
    const next = overOf(e);
    setOver(prev => (sameOver(prev, next) ? prev : next));
  };
  const onDragStart = (e: DragStartEvent) => setActive(find(e.active.id));
  const onDragEnd = (e: DragEndEvent) => {
    const drop = overOf(e);
    setActive(null);
    setOver(null);
    const item = find(e.active.id);
    const to = p.columns.find(c => c.id === drop?.column);
    if (!item || !drop || !to) return;
    const moved = to.id !== p.columnOf(item);
    if (moved && !accepts(to, item)) return;
    if (p.order) reorder(p.order, item, drop, moved);
    if (moved) p.onMove(item, to.id);
  };
  const onDragCancel = () => {
    setActive(null);
    setOver(null);
  };

  const insertAt = (key: string): Insert => (active === null || over?.card?.key !== key || p.keyOf(active) === key ? null : over.card.after ? "after" : "before");

  return (
    <DndContext sensors={sensors} collisionDetection={underPointer} onDragStart={onDragStart} onDragMove={track} onDragOver={track} onDragEnd={onDragEnd} onDragCancel={onDragCancel}>
      <div role="list" aria-label={p.label} className="flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto md:snap-none">
        {p.columns.map(col => {
          const cards = items.filter(i => p.columnOf(i) === col.id);
          const fromHere = active !== null && p.columnOf(active) === col.id;
          const droppable = accepts(col, active);
          return (
            <Column key={col.id} column={col} droppable={droppable || fromHere} count={col.total ?? cards.length} dragging={active !== null} target={droppable && !fromHere && over?.column === col.id && over.card === null}>
              {cards.map(item => {
                const key = p.keyOf(item);
                return (
                  <Card key={key} id={key} glyph={p.glyphOf(item)} selected={p.selected === key} onSelect={() => p.onSelect(key)} sortable={p.order !== undefined} insert={droppable || fromHere ? insertAt(key) : null}>
                    {p.renderCard(item)}
                  </Card>
                );
              })}
              {p.footer?.[col.id]}
            </Column>
          );
        })}
      </div>
      <DragOverlay dropAnimation={null}>
        {active && (
          <div className="flex rotate-2 gap-2.5 border border-fg bg-lift px-3.5 py-3 shadow-[0_10px_28px_#000c]">
            <GlyphIcon glyph={p.glyphOf(active)} className="mt-0.5" />
            <div className="min-w-0 flex-1">{p.renderCard(active)}</div>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

type Insert = "before" | "after" | null;

function Column<C extends string>({ column, droppable, count, dragging, target, children }: { column: KanbanColumn<C>; droppable: boolean; count: number; dragging: boolean; target: boolean; children: ReactNode }) {
  const { setNodeRef } = useDroppable({ id: column.id });

  return (
    <section
      ref={setNodeRef}
      role="listitem"
      aria-label={column.label}
      data-column={column.id}
      className={cn(
        "flex w-[85vw] shrink-0 snap-start flex-col overflow-y-auto border-r border-rule md:w-auto md:min-w-[220px] md:flex-1 md:shrink",
        target && "bg-drop",
        dragging && !droppable && "opacity-50",
      )}
    >
      <header className={cn("sticky top-0 z-[1] flex items-center justify-between border-b bg-bg px-4 py-3", target ? "border-warn" : "border-rule")}>
        <span className="flex items-center gap-2 text-[12px] font-semibold">
          <GlyphIcon glyph={column.glyph} />
          {column.label}
        </span>
        <span className="text-[10px] text-dim">{count}</span>
      </header>
      <div className={cn("flex flex-col", target && "border-t-2 border-warn")}>{children}</div>
    </section>
  );
}

function Card({ id, glyph, selected, onSelect, sortable, insert, children }: { id: string; glyph: Glyph; selected: boolean; onSelect: () => void; sortable: boolean; insert: Insert; children: ReactNode }) {
  const { setNodeRef: dragRef, attributes, listeners, isDragging } = useDraggable({ id });
  const { setNodeRef: dropRef } = useDroppable({ id: `${CARD}${id}`, disabled: !sortable });
  return (
    <div
      ref={node => {
        dragRef(node);
        dropRef(node);
      }}
      {...attributes}
      {...listeners}
      data-card={id}
      aria-pressed={selected}
      onClick={onSelect}
      onKeyDown={e => {
        if (e.key === "Enter") onSelect();
        else listeners?.onKeyDown?.(e);
      }}
      className={cn(
        "flex cursor-grab gap-2.5 border-b border-l-2 border-b-rule px-3.5 py-3 outline-none select-none focus-visible:bg-raise active:cursor-grabbing",
        selected ? "border-l-fg bg-raise" : "border-l-transparent hover:bg-hover",
        isDragging && "opacity-25",
        insert === "before" && "shadow-[inset_0_2px_0_var(--color-warn)]",
        insert === "after" && "shadow-[inset_0_-2px_0_var(--color-warn)]",
      )}
    >
      <GlyphIcon glyph={glyph} className="mt-0.5" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
