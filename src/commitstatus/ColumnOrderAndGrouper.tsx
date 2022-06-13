import React, { Component, CSSProperties, useState } from "react";
import {
  DragDropContext,
  Droppable,
  Draggable,
  DropResult,
  DraggableProvidedDraggableProps,
} from "react-beautiful-dnd";

export type Group = { id: string; name: string };

export type Selection = {
  grouped: Group[];
  ungrouped: Group[];
  removed: Group[];
};

type ListName = keyof Selection;

export const DragAndDropGrouper: React.FC<{
  selection: Selection;
  onChange: (selection: Selection) => void;
}> = ({ selection, onChange }) => {
  const original = onChange;
  onChange = (o) => {
    console.log(o);
    original(o);
  };
  const onDragEnd = (result: DropResult) => {
    const { source, destination } = result;
    if (!destination) return;

    if (source.droppableId === destination.droppableId) {
      onChange({
        ...selection,
        [source.droppableId]: reorder(
          selection[source.droppableId as ListName],
          source.index,
          destination.index
        ),
      });
      return;
    }

    const o: Partial<Selection> = {};
    const lists = {
      grouped: {
        list: selection.grouped,
        setList: (l: Group[]) => (o["grouped"] = l),
      },
      ungrouped: {
        list: selection.ungrouped,
        setList: (l: Group[]) => (o["ungrouped"] = l),
      },
      removed: {
        list: selection.removed,
        setList: (l: Group[]) => (o["removed"] = l),
      },
    };

    const sourceList = lists[source.droppableId as ListName];
    const destinationList = lists[destination.droppableId as ListName];

    const [nextSourceList, nextDestList] = move(
      { list: sourceList.list, index: source.index },
      { list: destinationList.list, index: destination.index }
    );

    sourceList.setList(nextSourceList);
    destinationList.setList(nextDestList);
    onChange({ ...selection, ...o });
  };

  const makeTarget = (type: ListName, styles?: CSSProperties) => (
    <Droppable droppableId={type} direction="horizontal">
      {(provided, snapshot) => (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            ...styles,
          }}
        >
          <div>
            {type.toLocaleUpperCase()}{" "}
            {type === "grouped" && selection.grouped.length ? (
              <button
                onClick={(e) => {
                  e.preventDefault();
                  onChange({
                    ...selection,
                    grouped: [],
                    ungrouped: [...selection.grouped, ...selection.ungrouped],
                  });
                }}
              >
                clear groups
              </button>
            ) : null}
          </div>
          <div
            ref={provided.innerRef}
            style={getListStyle(snapshot.isDraggingOver)}
            {...provided.droppableProps}
          >
            {selection[type].map((item, index) => (
              <Draggable key={item.id} draggableId={item.id} index={index}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.draggableProps}
                    {...provided.dragHandleProps}
                    style={getItemStyle(
                      snapshot.isDragging,
                      provided.draggableProps.style
                    )}
                  >
                    {item.name}
                  </div>
                )}
              </Draggable>
            ))}
            {provided.placeholder}
          </div>
        </div>
      )}
    </Droppable>
  );

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div style={{ display: "flex", gap: 10 }}>
        {makeTarget("grouped")}
        {makeTarget("ungrouped", { flexGrow: "1" })}
        {makeTarget("removed")}
      </div>
    </DragDropContext>
  );
};

function reorder<T>(list: T[], startIndex: number, endIndex: number) {
  const result = [...list];
  const [removed] = result.splice(startIndex, 1);
  result.splice(endIndex, 0, removed);
  return result;
}

function move<T>(
  source: { list: T[]; index: number },
  destination: { list: T[]; index: number }
) {
  const src = [...source.list];
  const dst = [...destination.list];
  const [removed] = src.splice(source.index, 1);
  dst.splice(destination.index, 0, removed);
  return [src, dst];
}

const grid = 8;

const getItemStyle = (
  isDragging: boolean,
  draggableStyle: DraggableProvidedDraggableProps["style"]
): CSSProperties => ({
  userSelect: "none",
  padding: grid,
  margin: `0 ${grid}px 0 0`,
  background: isDragging ? "lightgreen" : "var(--rdg-header-background-color)",
  boxSizing: "border-box",
  ...draggableStyle,
});

const getListStyle = (isDraggingOver: boolean): CSSProperties => ({
  background: isDraggingOver ? "lightblue" : "lightgrey",
  display: "flex",
  padding: grid,
  overflow: "auto",
  flexGrow: 1,
});
