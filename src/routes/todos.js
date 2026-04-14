"use strict";

const express = require("express");
const router = express.Router();

// In-memory store (replace with a DB in production)
let todos = [];
let nextId = 1;

// GET /todos — list all
router.get("/", (_req, res) => {
  res.json(todos);
});

// GET /todos/:id — get one
router.get("/:id", (req, res) => {
  const todo = todos.find((t) => t.id === parseInt(req.params.id));
  if (!todo) return res.status(404).json({ error: "Todo not found" });
  res.json(todo);
});

// POST /todos — create
router.post("/", (req, res) => {
  const { title } = req.body;
  if (!title || typeof title !== "string" || title.trim() === "") {
    return res
      .status(400)
      .json({ error: "title is required and must be a non-empty string" });
  }
  const todo = {
    id: nextId++,
    title: title.trim(),
    done: false,
    createdAt: new Date().toISOString(),
  };
  todos.push(todo);
  res.status(201).json(todo);
});

// PATCH /todos/:id — update
router.patch("/:id", (req, res) => {
  const todo = todos.find((t) => t.id === parseInt(req.params.id));
  if (!todo) return res.status(404).json({ error: "Todo not found" });

  const { title, done } = req.body;
  if (title !== undefined) {
    if (typeof title !== "string" || title.trim() === "") {
      return res
        .status(400)
        .json({ error: "title must be a non-empty string" });
    }
    todo.title = title.trim();
  }
  if (done !== undefined) {
    if (typeof done !== "boolean") {
      return res.status(400).json({ error: "done must be a boolean" });
    }
    todo.done = done;
  }

  res.json(todo);
});

// DELETE /todos/:id — delete
router.delete("/:id", (req, res) => {
  const index = todos.findIndex((t) => t.id === parseInt(req.params.id));
  if (index === -1) return res.status(404).json({ error: "Todo not found" });
  todos.splice(index, 1);
  res.status(204).send();
});

// Expose reset for testing
router.reset = () => {
  todos = [];
  nextId = 1;
};

module.exports = router;
