const parameterTypes = [{
    name: 'String',
    sql: 'string'
  },
  {
    name: 'Integer',
    sql: 'int'
  },
  {
    name: 'Float',
    sql: 'float'
  },
  {
    name: 'Boolean',
    sql: 'bool'
  }
];

function newParameter() {
  return {
    name: 'parameterName',
    type: parameterTypes[0].sql,
    cluster: false,
    render() {
      sql = `(SELECT value.${this.type}_value FROM UNNEST(event_params) as p WHERE key = '${this.name}' limit 1) as ${this.name}`
      return (sql)
    }
  }
}

function newEvent() {
  return {
    name: 'eventName',
    parameters: [newParameter()],
    renderCluster() {
      clusterColumns = this.parameters.filter(x => x.cluster).map(x => x.name)
      console.log(clusterColumns)
      return clusterColumns.length > 0 ? `CLUSTER BY ${clusterColumns.join(', ')}` : ''
    }, 
    renderSelect(dataset) {
      let params = ""
      for (let param of this.parameters) {
        params += `\n                ${param.render()}`
      }

      return `
            SELECT 
                user_pseudo_id, dt, ts, app_info.version as app_version, ${params}
            FROM \`${dataset}.events_clustered\`
            WHERE event_name = '${this.name}' `;
    },
    renderCreate(dataset) {
      return `       
            CREATE TABLE \`${dataset}.${this.name.toLowerCase()}\`
            PARTITION BY dt ${this.renderCluster()} AS 
            ${this.renderSelect(dataset)} ;
            `;
    },
    renderInsert(dataset) {
      const date = "DATE_SUB(CURRENT_DATE, interval 1 day)"
      const param_names = this.parameters.map(x => x.name).join(', ')

      return `
            DELETE FROM \`${dataset}.${this.name.toLowerCase()}\` WHERE dt = ${date};
            INSERT INTO \`${dataset}.${this.name.toLowerCase()}\`
            (user_pseudo_id, dt, ts, app_version, ${param_names}) 
            ${this.renderSelect(dataset)}
            AND dt = ${date};
            `
    }
  }
}

var app = new Vue({
  el: '#app',
  data: {
    parameterTypes,
    dataset: 'project.dataset',
    events: [],
  },
  methods: {
    addParameter(eventIndex) {
      this.events[eventIndex].parameters.push(newParameter());
    },
    addEvent() {
      this.events.push(newEvent());
    },
  },
  computed: {
    segmentedSelect() {
      return `
            SELECT 
                PARSE_DATE('%Y%m%d', event_date) AS dt, 
                event_name, 
                event_params, 
                TIMESTAMP_MICROS(event_timestamp) as ts, 
                TIMESTAMP_MICROS(event_previous_timestamp) as event_previous_timestamp, 
                event_value_in_usd, 
                event_server_timestamp_offset, 
                user_id, 
                user_pseudo_id,
                TIMESTAMP_MICROS(user_first_touch_timestamp) AS user_first_touch_timestamp, 
                user_properties, 
                user_ltv, 
                device, 
                geo, 
                app_info, 
                traffic_source, 
                platform
            FROM \`${this.dataset}.events_2*\``;
    },
    segmentedCreate() {
      return `       
            CREATE TABLE \`${this.dataset}.events_clustered\`
            PARTITION BY dt CLUSTER BY event_name AS 
            ${this.segmentedSelect} ;
            `;
    },
    segmentedInsert() {
      const date = "DATE_SUB(CURRENT_DATE, interval 1 day)";
      return `
            DELETE FROM \`${this.dataset}.events_clustered\` WHERE dt = ${date};
            INSERT INTO \`${this.dataset}.events_clustered\`
            (dt, event_name, event_params, ts, event_previous_timestamp, event_value_in_usd, 
            event_server_timestamp_offset, user_id, user_pseudo_id, user_first_touch_timestamp, user_properties, 
            user_ltv, device, geo, app_info, traffic_source, platform) 
            ${this.segmentedSelect}
            WHERE _TABLE_SUFFIX = REGEXP_REPLACE(FORMAT_DATE('%Y%m%d', ${date}), '^.', ''); 
            `
    },
    createAll() {
      let sql = this.segmentedCreate;
      for (let event of this.events) {
        sql += event.renderCreate(this.dataset);
      }

      return sql.split('            ').join('');
    },
    insertAll() {
      let sql = this.segmentedInsert;
      for (let event of this.events) {
        sql += event.renderInsert(this.dataset);
      }

      return sql.split('            ').join('');
    },
    queries() {
      return [
        {name: 'Create Query', query: this.createAll},
        {name: 'Daily Update Query', query: this.insertAll}
      ]
    }
  }
});

app.addEvent();
