/** some helper functions, mmmh, am I the only one needing those? Am I doing something wrong? */
// typical [[1,2,3], [6,7,8]] to [[1, 6], [2, 7], [3, 8]] converter
var transpose = (m) => m[0].map((x, i) => m.map((x) => x[i]));

// single items -> Array with item with length == 1
var listify = (obj) => (obj instanceof Array ? obj : [obj]);

// omg, js is still very broken, trouble comparing strings? 80s? plain-C? wtf!
var compare = function (a, b) {
  if (typeof a == "string") {
    return a.localeCompare(b);
  } else if (typeof b == "string") {
    return -1 * b.localeCompare(a);
  } else {
    return a - b;
  }
};

class DataTableZHA {
  constructor(cfg) {
    this.cfg = cfg;
    this.cols = cfg.columns;
    this.sort_by = cfg.sort_by;

    if (this.sort_by && !["+", "-"].includes(this.sort_by.slice(-1))) {
      this.sort_by += "+";
    }

    this.col_ids = this.cols.map(
      (col) => col.prop || col.attr || col.attr_as_list
    );

    this.headers = this.cols
      .filter((col) => !col.hidden)
      .map((col, idx) => col.name || this.col_ids[idx]);

    this.rows = [];
  }

  add(...rows) {
    this.rows.push(...rows.map((row) => row.render_data(this.cols)));
  }

  clear_rows() {
    this.rows = [];
  }

  get_rows() {
    // sorting is allowed asc/desc for one column
    if (this.sort_by) {
      let sort_col = this.sort_by;
      let sort_dir = 1;

      if (sort_col) {
        if (["-", "+"].includes(sort_col.slice(-1))) {
          // "-" => descending, "+" => ascending
          sort_dir = sort_col.slice(-1) == "-" ? -1 : +1;
          sort_col = sort_col.slice(0, -1);
        }
      }

      // determine col-by-idx to be sorted with...
      var sort_idx = this.cols.findIndex((col) =>
        ["id", "attr", "prop", "attr_as_list"].some(
          (attr) => attr in col && sort_col == col[attr]
        )
      );

      // if applicable sort according to config
      if (sort_idx > -1) {
        this.rows.sort(
          (x, y) =>
            sort_dir *
            compare(
              x.data[sort_idx] && x.data[sort_idx].content,
              y.data[sort_idx] && y.data[sort_idx].content
            )
        );
      } else {
        console.error(
          `config.sort_by: ${this.cfg.sort_by}, but column not found!`
        );
      }
    }

    // mark rows to be hidden due to 'strict' property
    this.rows = this.rows.filter((row) => !row.hidden);

    // truncate shown rows to 'max rows', if configured
    if ("max_rows" in this.cfg && this.cfg.max_rows > -1) {
      this.rows = this.rows.slice(0, this.cfg.max_rows);
    }

    return this.rows;
  }

  updateSortBy(idx) {
    let new_sort = this.cols[idx].attr || this.cols[idx].prop;
    if (this.sort_by && new_sort === this.sort_by.slice(0, -1)) {
      this.sort_by = new_sort + (this.sort_by.slice(-1) === "-" ? "+" : "-");
    } else {
      this.sort_by = new_sort + "+";
    }
  }
}

/** One level down, data representation for each row (including all cells) */
class DataRowZHA {
  constructor(device, strict, raw_data = null) {
    this.device = device;
    this.hidden = false;
    this.strict = strict;
    this.raw_data = raw_data;
    this.data = null;
    this.has_multiple = false;
  }

  get_raw_data(col_cfgs) {
    this.raw_data = col_cfgs.map((col) => {
      // collect the "raw" data from the requested source(s)
      if ("attr" in col) {
        return col.attr in this.device.attributes
          ? this.device.attributes[col.attr]
          : null;
      } else if ("prop" in col) {
        if (col.prop == "object_id") {
          return this.device.attributes.device_reg_id;
        } else if (col.prop == "name") {
          // handle device name customization
          if (
            "user_given_name" in this.device.attributes &&
            this.device.attributes["user_given_name"]
          ) {
            return this.device.attributes.user_given_name;
          } else {
            return this.device.attributes.name;
          }
        } else if (col.prop == "nwk") {
          let hex = this.device.attributes["nwk"];
          if (typeof value === "string") {
            hex = parseInt(value, 16);
          }
          return "0x" + hex.toString(16).padStart(4, "0");
        } else {
          return col.prop in this.device ? this.device[col.prop] : null;
        }
      } else if ("attr_as_list" in col) {
        this.has_multiple = true;
        return this.device.attributes[col.attr_as_list];
      } else {
        console.error(`no selector found for col: ${col.name} - skipping...`);
      }
      return null;
    });
  }

  render_data(col_cfgs) {
    // apply passed "modify" configuration setting by using eval()
    // assuming the data is available inside the function as "x"
    if (this.raw_data) {
      this.data = this.raw_data.map((raw, idx) => {
        // finally, put it all together
        let x = raw;
        let cfg = col_cfgs[idx];
        return new Object({
          content: cfg.modify ? eval(cfg.modify) : x ? x : "N/A",
          pre: cfg.prefix || "",
          suf: cfg.suffix || "",
          css: cfg.align || "left",
          hide: cfg.hidden,
        });
      });
    }
    if (this.data)
      this.hidden = this.data.some((data) => data === null);
    
    return this;
  }
}

/** The HTMLElement, which is used as a base for the Lovelace custom card */
class ZHANetworkCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({
      mode: "open",
    });
    this.card_height = 1;
    this.tbl = null;
  }

  setConfig(config) {
    // get & keep card-config and hass-interface
    const root = this.shadowRoot;

    if (root.lastChild) {
      root.removeChild(root.lastChild);
    }

    const cfg = Object.assign({}, config);
    const card = document.createElement("ha-card");
    card.header = cfg.title;
    const content = document.createElement("div");
    const style = document.createElement("style");
    this.tbl = new DataTableZHA(cfg);

    // some css style
    style.textContent = `
              table        { width: 100%;         padding: 16px;        }
              thead th     { text-align: left;                          }
              tr td, th    { padding-left: 0.5em; padding-right: 0.5em; } 
              tr td.left,   th.left   { text-align: left;               }
              tr td.center, th.center { text-align: center;             }
              tr td.right,  th.right  { text-align: right;              } 
              th             { background-color: #03a9f4; color: white; }
              .headerSortDown:after,
              .headerSortUp:after { content: ' '; position: relative; left: 2px; border: 8px solid transparent; }
              .headerSortDown:after { top: 10px; border-top-color: white; }
              .headerSortUp:after { bottom: 15px; border-bottom-color: white; }
              .headerSortDown,
              .headerSortUp { padding-right: 10px;}
              tbody tr:nth-child(odd)  { background-color: var(--paper-card-background-color); }
              tbody tr:nth-child(even) { background-color: var(--secondary-background-color);  }
        `;

    // table skeleton, body identified with: 'zhatable'
    content.innerHTML = `
            <div style="overflow-x:auto;">
                <table>
                    <thead>
                        <tr>${this.tbl.headers
                          .map(
                            (name, idx) =>
                              `<th class="${
                                cfg.columns[idx].align || "left"
                              }" id="${name}">${name}</th>`
                          )
                          .join("")}</tr>
                    </thead>
                    <tbody id='zhatable'></tbody>
                </table>
            </div>
        `;

    // push css-style & table as content into the card's DOM tree
    card.appendChild(style);
    card.appendChild(content);
    root.appendChild(card);

    // add sorting click handler to header elements
    this.tbl.headers.map((name, idx) => {
      root.getElementById(name).onclick = (click) => {
        // remove previous sort by
        this.tbl.headers.map((name, idx) => {
          root.getElementById(name).classList.remove("headerSortDown");
          root.getElementById(name).classList.remove("headerSortUp");
        });
        this.tbl.updateSortBy(idx);
        if (this.tbl.sort_by.indexOf("+") != -1) {
          root.getElementById(name).classList.add("headerSortUp");
        } else {
          root.getElementById(name).classList.add("headerSortDown");
        }
        this._updateContent(
          root.getElementById("zhatable"),
          this.tbl.get_rows()
        );
      };
    });

    this._config = cfg;
  }

  _updateContent(element, rows) {
    // callback for updating the cell-contents
    element.innerHTML = rows
      .map(
        (row) =>
          `<tr id="device_row_${
            row.device.attributes.device_reg_id
          }">${row.data
            .map((cell) =>
              !cell.hide
                ? `<td class="${cell.css}">${cell.pre}${cell.content}${cell.suf}</td>`
                : ""
            )
            .join("")}</tr>`
      )
      .join("");

    // if configured, set clickable row to show device popup-dialog
    rows.forEach((row) => {
      const elem = this.shadowRoot.getElementById(
        `device_row_${row.device.attributes.device_reg_id}`
      );
      const root = this.shadowRoot;
      // bind click()-handler to row (if configured)
      elem.onclick = this.tbl.cfg.clickable
        ? function (clk_ev) {
            let ev = new Event("location-changed", {
              bubbles: true,
              cancelable: false,
              composed: true,
            });
            ev.detail = { replace: false };
            history.pushState(
              null,
              "",
              "/config/devices/device/" + row.device.attributes.device_reg_id
            );
            root.dispatchEvent(ev);
          }
        : null;
    });
  }

  async init(hass, config, root) {
    await hass
      .callWS({
        type: "zha/devices",
      })
      .then(async (devices) => {
        // `raw_rows` to be filled with data here, due to 'attr_as_list' it is possible to have
        // multiple data `raw_rows` acquired into one cell(.raw_data), so re-iterate all rows
        // to---if applicable---spawn new DataRowZHA objects for these accordingly
        const raw_rows = devices.map(
          (e) => new DataRowZHA({ attributes: e }, config.strict)
        );
        const read_sw_build_id = config.columns.filter((col) => col.prop == "sw_build_id");
        await Promise.allSettled(raw_rows.map(async (e) => {
          if (read_sw_build_id && e.device.attributes.available) {
            // retrieving cluster attributes requires additional ws calls
            await hass.callWS({
              type: "zha/devices/clusters",
              ieee: e.device.attributes.ieee
            }).then(async (clusters) => {
              for (const cluster of clusters) {
                if (cluster["type"] == "in" && cluster["name"] == "Basic") {
                  e.device.sw_build_id = await hass.callWS({
                    type: "zha/devices/clusters/attributes/value",
                    "ieee": e.device.attributes.ieee,
                    "endpoint_id": cluster.endpoint_id,
                    "cluster_id": cluster.id,
                    "cluster_type": "in",
                    "attribute": 0x4000,
                  }).then((value) => {
                    console.log("DEBUG: %s (%s) has sw_build_id %s", e.device.attributes.ieee, JSON.stringify(e.device.attributes.user_given_name || e.device.attributes.name), value)
                    return value
                  }).catch((error) => {
                    console.log("DEBUG: failed to retrieve sw_build_id for device %s: %s", e.device.attributes.ieee, JSON.stringify(error))
                    return error.message
                  });
                }
              }
            }).catch((error) => {
              console.log("DEBUG: failed to retrieve clusters for device %s: %s", e.device.attributes.ieee, JSON.stringify(error))
              return error.message
            });
          } else {
            console.log("DEBUG: %s", JSON.stringify(error))
            e.device.sw_build_id = "N/A"
          }
          e.get_raw_data(config.columns)
        }));

        // now add() the raw_data rows to the DataTableZHA
        this.tbl.clear_rows();
        raw_rows.forEach((row_obj) => {
          if (!row_obj.has_multiple) this.tbl.add(row_obj);
          else
            this.tbl.add(
              ...transpose(row_obj.raw_data).map(
                (new_raw_data) =>
                  new DataRowZHA(row_obj.device, row_obj.strict, new_raw_data)
              )
            );
        });

        // finally set card height and insert card
        this._setCardSize(this.tbl.rows.length);
        // all preprocessing / rendering will be done here inside DataTableZHA::get_rows()
        this._updateContent(
          root.getElementById("zhatable"),
          this.tbl.get_rows()
        );
      });
  }

  set hass(hass) {
    console.log("DEBUG: set hass(hass) is called")
    const config = this._config;
    const root = this.shadowRoot;

    if (!this.initialized) {
      this.initialized = true
      this.init(hass, config, root);
    }
  }

  _setCardSize(num_rows) {
    this.card_height = parseInt(num_rows * 0.5);
  }

  getCardSize() {
    return this.card_height;
  }
}

customElements.define("zha-network-card", ZHANetworkCard);
