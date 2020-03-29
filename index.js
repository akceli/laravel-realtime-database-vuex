import http from "@/api/http";

export const RealtimeStore = {
  pusher: null,
  channels: [],
  setPusher(pusher) {
    this.pusher = pusher;
  },
  subscribeToChannel(channel, vuexStore) {
    if (!this.pusher) {
      console.log('Pusher is not setup yet: ', channel);
      return;
    }
  
    console.log('Setup Store: ', channel);
    let [store, channel_id] = channel.split('.');
    this.channels[channel] = this.pusher.subscribe(channel);
    if (vuexStore) this.channels[channel].vuexStore = vuexStore;
    if (store) this.channels[channel].store = store;
    this.channels[channel].bind('event', payload => {
      this.processStoreChanges(payload.data);
    });
  
    console.log('Channels: ', this.channels);
    return http().get(`/v1/new-store/${store}/${channel_id}`);
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
  },
};

export default RealtimeStore;