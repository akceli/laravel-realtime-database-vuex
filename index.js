import http from '@/api/http';

export const RealtimeStore = {
  pusher: null,
  Vue: null,
  vuexStore: {},
  channels: [],
  setPusher(pusher) {
    this.pusher = pusher;
  },
  setStore(store) {
    this.vuexStore = store;
  },
  setVue(Vue) {
    this.Vue = Vue;
  },
  init(Vue, store, pusher) {
    this.setVue(Vue);
    this.setStore(store);
    this.setPusher(pusher);
  },
  getChannel(store, channel_id) {
    return this.channels[store + ':' + channel_id];
  },
  getResource(store, channel_id, prop) {
    return this.getChannel(store, channel_id).resources[prop];
  },
  subscribeToChannel(store, channel_id, options) {
    let defaultOptions = {};
    if (options) {
      options = {...defaultOptions, ...options};
    } else {
      options = defaultOptions;
    }
    
    let channel_string = store + ':' + channel_id;
    if (!this.pusher) {
      console.error('Pusher is not setup yet: ', channel_string);
      return;
    }
    if (this.channels[channel_string]) {
      console.error('You are already subscribed to this channel: ', channel_string);
      return;
    }
  
    const channel = this.pusher.subscribe(channel_string);
    this.channels[channel_string] = channel;
    
    channel.bind('event', payload => {
      this.processStoreChanges(payload.data);
    });
    
    let query = '?';
    if (options.required) {
      query += 'with=' + options.required + '&';
    }
    if (options.size) {
      query += 'size=' + options.size;
    }
  
    const vuexStore = this.vuexStore;
    return http().get(`${process.env.MIX_CLIENT_STORE_URL}/${store}/${channel_id}` + query).then(response => {
      vuexStore.commit('initStore', {
        store: store,
        channel_id: channel_id,
        data: response.data
      });
  
      channel.resources = [];
      Object.keys(response.data).forEach((prop) => {
        let url = `${process.env.MIX_CLIENT_STORE_URL}/${store}/${channel_id}/${prop}`;
        channel.resources[prop] = {
          channel: channel,
          options: options,
          appendNextPage() {
            return http().get(url + '?offset=' + this.getCollectionLength()).then(response => {
              response.data.data.forEach((item) => {
                vuexStore.commit('upsertCollection', {
                  store: store,
                  prop: prop,
                  data: item,
                  channel_id: channel_id
                });
              });
          
              return response;
            });
          },
          appendAll() {
            this.appendNextPage().then(response => {
              if (response.data.data.length) {
                this.appendAll();
              }
            });
          },
          getCollectionLength() {
            // return vuexStore.state[store][prop].data.length;
            return vuexStore.state[store + '.' + channel_id][prop].data.length;
          }
        };
      });
  
      return response.data;
    });
  },
  unsubscribeToChannel (channel) {
    this.pusher.unsubscribe(channel);
    delete this.vuexStore.state[channel.store + ':' + channel.channel_id];
    delete this.channels[channel];
  },
  processStoreChanges(payload) {
    const channel = this.channels[payload.store + ':' + payload.channel_id];
    
    /** Ignore channels you are not subscribed to */
    if (!channel) {
      console.log('Ignoring Channel: ', payload.channel);
      return;
    }
  
    setTimeout(() => {
      if (payload.data) {
        this.vuexStore.commit(payload.method, payload);
      } else {
        http().get(payload.api_call).then(res => {
          payload.data = res.data;
          this.vuexStore.commit(payload.method, payload);
        });
      }
    
    }, payload.delay);
  },
  apiSuccessMiddleware (response) {
    if (response.data.clientStoreChanges) {
      response.data.clientStoreChanges.forEach(payload => {
        this.processStoreChanges(payload)
      });
      
      delete response.data.clientStoreChanges;
    }
    
    if (response.data.responseData) {
      response.data = response.data.responseData;
    }
    
    return response;
  },
  apiErrorMiddleware (error) {
    if (error.response.data.responseData) {
      error.response.data = error.response.data.responseData;
    }
    
    return error;
  },
  channelMutations: {
    updateInCollection(state, payload) {
      state[payload.store + '.' + payload.channel_id][payload.prop].data = state[payload.store + '.' + payload.channel_id][payload.prop].data.map(item => item.id === payload.data.id ? {...item, ...payload.data} : item);
    },
    addToCollection(state, payload) {
      let collection = state[payload.store + '.' + payload.channel_id][payload.prop].data;
      if (!collection.some(item => item.id === payload.data.id)) {
        collection.push(payload.data);
      }
    },
    upsertCollection(state, payload) {
      let collection = state[payload.store + '.' + payload.channel_id][payload.prop].data;
      if (!collection.some(item => item.id === payload.data.id)) {
        collection.push(payload.data);
      } else {
        state[payload.store + '.' + payload.channel_id][payload.prop].data = state[payload.store + '.' + payload.channel_id][payload.prop].data.map(item => item.id === payload.data.id ? {...item, ...payload.data} : item);
      }
    },
    removeFromCollection(state, payload) {
      state[payload.store + '.' + payload.channel_id][payload.prop].data = state[payload.store + '.' + payload.channel_id][payload.prop].data.filter(item => item.id !== payload.data.id);
    },
    setRoot(state, payload) {
      state[payload.store + '.' + payload.channel_id][payload.prop].data = payload.data;
    },
    initStore(state, payload) {
      if (!state[payload.store]) {
        // state[payload.store] = {};
        RealtimeStore.Vue.set( state, [payload.store + '.' + payload.channel_id], {});
      }
      // state[payload.store + '.' + payload.channel_id] = payload.data;
      RealtimeStore.Vue.set( state, [payload.store + '.' + payload.channel_id], payload.data);
    }
  },
  storeMutations: {
    updateInCollection(state, payload) {
      state[payload.store][payload.prop].data = state[payload.store][payload.prop].data.map(item => item.id === payload.data.id ? {...item, ...payload.data} : item);
    },
    addToCollection(state, payload) {
      let collection = state[payload.store][payload.prop].data;
      if (!collection.some(item => item.id === payload.data.id)) {
        collection.push(payload.data);
      }
    },
    upsertCollection(state, payload) {
      let collection = state[payload.store][payload.prop].data;
      if (!collection.some(item => item.id === payload.data.id)) {
        collection.push(payload.data);
      } else {
        state[payload.store][payload.prop].data = state[payload.store][payload.prop].data.map(item => item.id === payload.data.id ? {...item, ...payload.data} : item);
      }
    },
    removeFromCollection(state, payload) {
      state[payload.store][payload.prop].data = state[payload.store][payload.prop].data.filter(item => item.id !== payload.data.id);
    },
    setRoot(state, payload) {
      state[payload.store][payload.prop].data = payload.data;
    },
    initStore(state, payload) {
      if (!state[payload.store]) {
        state[payload.store] = {};
      }
      state[payload.store] = payload.data;
    }
  },
};

export default RealtimeStore;