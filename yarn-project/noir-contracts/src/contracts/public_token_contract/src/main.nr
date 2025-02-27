// docs:start:all
contract PublicToken {
    use dep::std::option::Option;

    // docs:start:unencrypted_import
    use dep::aztec::log::emit_unencrypted_log;
    // docs:end:unencrypted_import

    use dep::aztec::{
        context::{PrivateContext, PublicContext, Context},
        state_vars::{
            map::Map,
            public_state::PublicState,
        },
        types::type_serialization::field_serialization::{
            FieldSerializationMethods, FIELD_SERIALIZED_LEN,
        },
    };

    struct Storage {
        balances: Map<PublicState<Field, FIELD_SERIALIZED_LEN>>,
    }

    impl Storage {
        fn init(context: Context) -> pub Self {
            Storage {
                balances: Map::new(
                    context,
                    1,
                    |context, slot| {
                        PublicState::new(context, slot, FieldSerializationMethods)
                    },
                ),
            }
        }
    }

    // Constructs the contract.
    // docs:start:empty-constructor
    #[aztec(private)]
    fn constructor() {}
    // docs:end:empty-constructor

    // Mints `amount` of tokens to a `recipient`.
    #[aztec(public)]
    fn mint(
        amount: Field,
        recipient: Field,
    ) -> Field {

        
        let recipient_balance = storage.balances.at(recipient);
        let new_amount = recipient_balance.read() + amount;
        // TODO: Remove return value.
        // docs:start:unencrypted_log
        emit_unencrypted_log(&mut context, "Coins minted");
        // docs:end:unencrypted_log
        recipient_balance.write(new_amount);

        new_amount
    }

    // Transfers `amount` of tokens from `msg_sender` to `recipient`.
    #[aztec(public)]
    fn transfer(
        amount: Field,
        recipient: Field,
    ) -> Field {
        
        let sender = context.msg_sender();

        let sender_balance = storage.balances.at(sender);
        let recipient_balance = storage.balances.at(recipient);

        let current_sender_balance: Field = sender_balance.read();
        let current_recipient_balance = recipient_balance.read();

        // TODO: Should support larger numbers.
        let mut return_value = 0;

        if (current_sender_balance as u126 > amount as u126) {
            sender_balance.write(current_sender_balance - amount);
            // TODO: Compiler complains if we don't assign the result of the write to anything
            emit_unencrypted_log(&mut context, "Coins transferred");
            let amount = current_recipient_balance + amount;
            recipient_balance.write(amount);
            return_value = amount;
        } else {
            // TODO: Revert if there is not enough balance
            return_value = current_recipient_balance;
        }
        return_value
    }

    unconstrained fn publicBalanceOf(
        owner: Field,
    ) -> Field {
        
        storage.balances.at(owner).read()
    }
}
// docs:end:all