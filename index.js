import http from "@/api/http";

export const RealtimeStore = {
  pusher: null,
  channels: [],
  setPusher(pusher) {
    this.pusher = pusher;
  },
  subscribeToChannel(store, channel_id, vuexStore) {
    let channel_string = store + '.' + channel_id;
    if (!this.pusher) {
      console.log('Pusher is not setup yet: ', channel_string);
      return;
    }
  
    const channel = this.pusher.subscribe(channel_string);
    this.channels[channel_string] = channel;
    if (vuexStore) {
      channel.vuexStore = vuexStore;
    } else {
      channel.store = {};
    }
    
    channel.bind('event', payload => {
      this.processStoreChanges(payload.data);
    });
  
    return http().get(`/v1/new-store/${store}/${channel_id}`).then(response => {
      if (channel.store) {
        channel.store = response.data;
        return channel.store;
      } else if (channel.vuexStore) {
        channel.vuexStore.commit('initStore', {
          store: store,
          data: response.data
        });
        return response.data;
      }
    });
  },
  unsubscribeToChannel (channel) {
    this.pusher.unsubscribe(channel);
    delete this.channels[channel];
  },
  processStoreChanges(payload) {
    console.log('Processing payload: ', payload, this.channels);
    const channel = this.channels[payload.channel];
    
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
      this.internalStoreMethods[payload.method](channel.store, payload)
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
      state[payload.store][payload.prop] = state[payload.store][payload.prop].map(item => item.id === payload.data.id ? {...item, ...payload.data} : item);
    },
    addToCollection(state, payload) {
      let collection = state[payload.store][payload.prop];
      if (!collection.some(item => item.id === payload.data.id)) {
        collection.push(payload.data);
      }
    },
    upsertCollection(state, payload) {
      let collection = state[payload.store][payload.prop];
      if (!collection.some(item => item.id === payload.data.id)) {
        collection.push(payload.data);
      } else {
        state[payload.store][payload.prop] = state[payload.store][payload.prop].map(item => item.id === payload.data.id ? {...item, ...payload.data} : item);
      }
    },
    removeFromCollection(state, payload) {
      state[payload.store][payload.prop] = state[payload.store][payload.prop].filter(item => item.id !== payload.data.id);
    },
    setRoot(state, payload) {
      state[payload.store][payload.prop] = payload.data;
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