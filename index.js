import http from '@/api/http';

export const RealtimeStore = {
  pusher: null,
  state: {},
  channels: [],
  setPusher(pusher) {
    this.pusher = pusher;
  },
  getChannel(store, channel_id) {
    return this.channels[store + '.' + channel_id];
  },
  getStore(store, channel_id) {
    if (!this.state || !this.state[store + '.' + channel_id]) {
      return undefined;
    }
    return this.state[store][channel_id];
    // return this.getChannel(store, channel_id).vuexStore.state[store];
  },
  getData(store, channel_id, prop, defaultData) {
    if (this.getStore(store, channel_id) === undefined) {
      if (defaultData !== undefined) {
        return defaultData;
      }
      return undefined;
    }
    
    return this.getStore(store, channel_id)[prop];
  },
  getCollectionData(store, channel_id, prop, defaultData) {
    if (this.getData(store, channel_id) === undefined) {
      if (defaultData !== undefined) {
        return defaultData;
      }
      return undefined;
    }
  
    return this.getData(store, channel_id, prop).data;
  },
  getResource(store, channel_id, prop) {
    return this.getChannel(store, channel_id).resources[prop];
  },
  subscribeToChannel(store, channel_id, options) {
    let channel_string = store + '.' + channel_id;
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
    // if (vuexStore) {
    //   channel.vuexStore = vuexStore;
    // }
    
    channel.bind('event', payload => {
      this.processStoreChanges(payload.data);
    });
    
    let query = '?';
    if (options && options.with) {
      query += 'with=' + options.with + '&';
    }
    if (options && options.size) {
      query += 'size=' + options.size;
    }
  
    return http().get(`${process.env.MIX_CLIENT_STORE_URL}/${store}/${channel_id}` + query).then(response => {
      this.state[store + '.' + channel_id] = response.data;
      // this.state[store][channel_id] = response.data;
      
      if (channel.vuexStore) {
        channel.vuexStore.commit('initStore', {
          store: store,
          data: response.data
        });
      }
      
      channel.resources = [];
      let internalMethods = this.internalStoreMethods;
      let state = this.state[store + '.' + channel_id];
      Object.keys(response.data).forEach((prop) => {
        let url = `${process.env.MIX_CLIENT_STORE_URL}/${store}/${channel_id}/${prop}`;
        channel.resources[prop] = {
          channel: channel,
          options: options,
          appendNextPage() {
            return http().get(url + '?size=10&offset=' + this.getCollectionLength()).then(response => {
              response.data.data.forEach((item) => {
                let payload = {prop: prop, data: item};
                console.log('State: ', state, 'Payload: ', payload);
                internalMethods.upsertCollection(state, payload);
                if (channel.vuexStore) {
                  channel.vuexStore.commit('upsertCollection', {
                    store: store,
                    prop: prop,
                    data: item
                  });
                }
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
            // console.log('State: ', state[prop].data.length);
            return state[prop].data.length;
            // return this.channel.vuexStore.state[store][prop].data.length;
          }
        };
      });
  
      return response.data;
    });
  },
  unsubscribeToChannel (channel) {
    this.pusher.unsubscribe(channel);
    delete this.channels[channel];
  },
  processStoreChanges(payload) {
    console.log('Processing payload: ', payload, this.channels);
    const channel = this.channels[payload.store + '.' + payload.channel_id];
    
    /** Ignore channels you are not subscribed to */
    if (!channel) {
      console.log('Ignoring Channel: ', payload.channel);
      return;
    }
    
    /** If channel has a Vuex Store */
    
    if (channel.vuexStore) {
      setTimeout(() => {
        if (payload.data) {
          channel.vuexStore.commit(payload.method, payload);
        } else {
          http().get(payload.api_call).then(res => {
            payload.data = res.data;
            channel.vuexStore.commit(payload.method, payload);
          });
        }
        
      }, payload.delay);
    } else if (channel.store) {
      this.internalStoreMethods[payload.method](this.getStore(payload.store, payload.channel_id), payload)
    }
  },
  apiSuccessMiddleware (response) {
    if (response.data.clientStoreChanges) {
      response.data.clientStoreChanges.forEach(payload => {
        console.log('Http Payload Change', payload);
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
  vuexMutations: {
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
      console.log('State: ', state, payload);
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
      state[payload.store] = payload.data;
    }
  },
  internalStoreMethods: {
    updateInCollection(state, payload) {
      state[payload.prop] = state[payload.prop].map(item => item.id === payload.data.id ? {...item, ...payload.data} : item);
    },
    addToCollection(state, payload) {
      let collection = state[payload.prop];
      if (!collection.some(item => item.id === payload.data.id)) {
        collection.push(payload.data);
      }
    },
    upsertCollection(state, payload) {
      let collection = state[payload.prop];
      if (!collection.some(item => item.id === payload.data.id)) {
        collection.push(payload.data);
      } else {
        state[payload.prop] = state[payload.prop].map(item => item.id === payload.data.id ? {...item, ...payload.data} : item);
      }
    },
    removeFromCollection(state, payload) {
      state[payload.prop] = state[payload.prop].filter(item => item.id !== payload.data.id);
    },
    setRoot(state, payload) {
      state[payload.prop] = payload.data;
    },
  }
};

export default RealtimeStore;