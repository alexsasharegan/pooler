import * as r from "rethinkdb";
import { NewPooler } from "../lib";

const pool = NewPooler({
  max: 10, // default
  min: 3, // default
  max_retries: 3, // default
  buffer_on_start: true, // default
  timeout: 250, // default
  timeout_cap: 30000, // default
  async factory() {
    return await r.connect("localhost:8080");
  },
  async destructor(conn) {
    await conn.close();
  },
  is_ok_sync(conn) {
    return conn.open;
  },
});

app.get("/products", async (req, res) => {
  pool.use(async conn => {
    let cursor = await r.table("products").run(conn);
    let products = await cursor.toArray();
    res.json(products);
    res.end();
  });
});
