#pragma once
#include "relation_parameters.hpp"
#include "relation_types.hpp"

namespace proof_system {

template <typename FF_> class GenPermSortRelationImpl {
  public:
    using FF = FF_;

    // 1 + polynomial degree of this relation
    static constexpr size_t RELATION_LENGTH = 6; // degree(q_sort * D(D - 1)(D - 2)(D - 3)) = 5

    static constexpr size_t LEN_1 = 6; // range constrain sub-relation 1
    static constexpr size_t LEN_2 = 6; // range constrain sub-relation 2
    static constexpr size_t LEN_3 = 6; // range constrain sub-relation 3
    static constexpr size_t LEN_4 = 6; // range constrain sub-relation 4
    template <template <size_t...> typename SubrelationAccumulatorsTemplate>
    using GetAccumulatorTypes = SubrelationAccumulatorsTemplate<LEN_1, LEN_2, LEN_3, LEN_4>;

    /**
     * @brief Expression for the generalized permutation sort gate.
     * @details The relation is defined as C(extended_edges(X)...) =
     *    q_sort * \sum{ i = [0, 3]} \alpha^i D_i(D_i - 1)(D_i - 2)(D_i - 3)
     *      where
     *      D_0 = w_2 - w_1
     *      D_1 = w_3 - w_2
     *      D_2 = w_4 - w_3
     *      D_3 = w_1_shift - w_4
     *
     * @param evals transformed to `evals + C(extended_edges(X)...)*scaling_factor`
     * @param extended_edges an std::array containing the fully extended Univariate edges.
     * @param parameters contains beta, gamma, and public_input_delta, ....
     * @param scaling_factor optional term to scale the evaluation before adding to evals.
     */
    template <typename AccumulatorTypes>
    void static accumulate(typename AccumulatorTypes::Accumulators& accumulators,
                           const auto& extended_edges,
                           const RelationParameters<FF>&,
                           const FF& scaling_factor)
    {
        // OPTIMIZATION?: Karatsuba in general, at least for some degrees?
        //       See https://hackmd.io/xGLuj6biSsCjzQnYN-pEiA?both

        using View = typename std::tuple_element<0, typename AccumulatorTypes::AccumulatorViews>::type;
        auto w_1 = View(extended_edges.w_l);
        auto w_2 = View(extended_edges.w_r);
        auto w_3 = View(extended_edges.w_o);
        auto w_4 = View(extended_edges.w_4);
        auto w_1_shift = View(extended_edges.w_l_shift);
        auto q_sort = View(extended_edges.q_sort);

        static const FF minus_one = FF(-1);
        static const FF minus_two = FF(-2);
        static const FF minus_three = FF(-3);

        // Compute wire differences
        auto delta_1 = w_2 - w_1;
        auto delta_2 = w_3 - w_2;
        auto delta_3 = w_4 - w_3;
        auto delta_4 = w_1_shift - w_4;

        // Contribution (1)
        auto tmp_1 = delta_1;
        tmp_1 *= (delta_1 + minus_one);
        tmp_1 *= (delta_1 + minus_two);
        tmp_1 *= (delta_1 + minus_three);
        tmp_1 *= q_sort;
        tmp_1 *= scaling_factor;
        std::get<0>(accumulators) += tmp_1;

        // Contribution (2)
        auto tmp_2 = delta_2;
        tmp_2 *= (delta_2 + minus_one);
        tmp_2 *= (delta_2 + minus_two);
        tmp_2 *= (delta_2 + minus_three);
        tmp_2 *= q_sort;
        tmp_2 *= scaling_factor;
        std::get<1>(accumulators) += tmp_2;

        // Contribution (3)
        auto tmp_3 = delta_3;
        tmp_3 *= (delta_3 + minus_one);
        tmp_3 *= (delta_3 + minus_two);
        tmp_3 *= (delta_3 + minus_three);
        tmp_3 *= q_sort;
        tmp_3 *= scaling_factor;
        std::get<2>(accumulators) += tmp_3;

        // Contribution (4)
        auto tmp_4 = delta_4;
        tmp_4 *= (delta_4 + minus_one);
        tmp_4 *= (delta_4 + minus_two);
        tmp_4 *= (delta_4 + minus_three);
        tmp_4 *= q_sort;
        tmp_4 *= scaling_factor;
        std::get<3>(accumulators) += tmp_4;
    };
};

template <typename FF_> class GoblinTranslatorGenPermSortRelationImpl {
  public:
    using FF = FF_;

    // 1 + polynomial degree of this relation
    static constexpr size_t RELATION_LENGTH = 6; // degree((lagrange_last-1) * D(D - 1)(D - 2)(D - 3)) = 5
    static constexpr size_t LEN_1 = 6;
    static constexpr size_t LEN_2 = 6;
    static constexpr size_t LEN_3 = 6;
    static constexpr size_t LEN_4 = 6;
    static constexpr size_t LEN_5 = 6;
    static constexpr size_t LEN_6 = 3;
    static constexpr size_t LEN_7 = 3;
    static constexpr size_t LEN_8 = 3;
    static constexpr size_t LEN_9 = 3;
    static constexpr size_t LEN_10 = 3;
    template <template <size_t...> typename SubrelationAccumulatorsTemplate>
    using GetAccumulatorTypes =
        SubrelationAccumulatorsTemplate<LEN_1, LEN_2, LEN_3, LEN_4, LEN_5, LEN_6, LEN_7, LEN_8, LEN_9, LEN_10>;

    /**
     * @brief Expression for the generalized permutation sort relation
     *
     * @details The relation enforces 2 constraints on each of the ordered_range_constraints wires:
     * 1) 2 sequential values are non-descending and have a difference of at most 3, except for the value at last index
     * 2) The value at last index is (1<<14)-1
     *
     * @param evals transformed to `evals + C(extended_edges(X)...)*scaling_factor`
     * @param extended_edges an std::array containing the fully extended Univariate edges.
     * @param parameters contains beta, gamma, and public_input_delta, ....
     * @param scaling_factor optional term to scale the evaluation before adding to evals.
     */
    template <typename AccumulatorTypes>
    void static accumulate(typename AccumulatorTypes::Accumulators& accumulators,
                           const auto& extended_edges,
                           const RelationParameters<FF>&,
                           const FF& scaling_factor)
    {
        using View = typename std::tuple_element<0, typename AccumulatorTypes::AccumulatorViews>::type;
        auto ordered_range_constraints_0 = View(extended_edges.ordered_range_constraints_0);
        auto ordered_range_constraints_1 = View(extended_edges.ordered_range_constraints_1);
        auto ordered_range_constraints_2 = View(extended_edges.ordered_range_constraints_2);
        auto ordered_range_constraints_3 = View(extended_edges.ordered_range_constraints_3);
        auto ordered_range_constraints_4 = View(extended_edges.ordered_range_constraints_4);
        auto ordered_range_constraints_0_shift = View(extended_edges.ordered_range_constraints_0_shift);
        auto ordered_range_constraints_1_shift = View(extended_edges.ordered_range_constraints_1_shift);
        auto ordered_range_constraints_2_shift = View(extended_edges.ordered_range_constraints_2_shift);
        auto ordered_range_constraints_3_shift = View(extended_edges.ordered_range_constraints_3_shift);
        auto ordered_range_constraints_4_shift = View(extended_edges.ordered_range_constraints_4_shift);
        auto lagrange_last = View(extended_edges.lagrange_last);

        static const FF minus_one = FF(-1);
        static const FF minus_two = FF(-2);
        static const FF minus_three = FF(-3);

        static const auto maximum_sort_value = -FF((1 << 14) - 1);
        // Compute wire differences
        auto delta_1 = ordered_range_constraints_0_shift - ordered_range_constraints_0;
        auto delta_2 = ordered_range_constraints_1_shift - ordered_range_constraints_1;
        auto delta_3 = ordered_range_constraints_2_shift - ordered_range_constraints_2;
        auto delta_4 = ordered_range_constraints_3_shift - ordered_range_constraints_3;
        auto delta_5 = ordered_range_constraints_4_shift - ordered_range_constraints_4;

        // Contribution (1) (contributions 1-5 ensure that the sequential values have a difference of {0,1,2,3})
        auto tmp_1 = delta_1;
        tmp_1 *= (delta_1 + minus_one);
        tmp_1 *= (delta_1 + minus_two);
        tmp_1 *= (delta_1 + minus_three);
        tmp_1 *= (lagrange_last + minus_one);
        tmp_1 *= scaling_factor;
        std::get<0>(accumulators) += tmp_1;

        // Contribution (2)
        auto tmp_2 = delta_2;
        tmp_2 *= (delta_2 + minus_one);
        tmp_2 *= (delta_2 + minus_two);
        tmp_2 *= (delta_2 + minus_three);
        tmp_2 *= (lagrange_last + minus_one);
        tmp_2 *= scaling_factor;

        std::get<1>(accumulators) += tmp_2;

        // Contribution (3)
        auto tmp_3 = delta_3;
        tmp_3 *= (delta_3 + minus_one);
        tmp_3 *= (delta_3 + minus_two);
        tmp_3 *= (delta_3 + minus_three);
        tmp_3 *= (lagrange_last + minus_one);
        tmp_3 *= scaling_factor;
        std::get<2>(accumulators) += tmp_3;

        // Contribution (4)
        auto tmp_4 = delta_4;
        tmp_4 *= (delta_4 + minus_one);
        tmp_4 *= (delta_4 + minus_two);
        tmp_4 *= (delta_4 + minus_three);
        tmp_4 *= (lagrange_last + minus_one);
        tmp_4 *= scaling_factor;
        std::get<3>(accumulators) += tmp_4;

        // Contribution (5)
        auto tmp_5 = delta_5;
        tmp_5 *= (delta_5 + minus_one);
        tmp_5 *= (delta_5 + minus_two);
        tmp_5 *= (delta_5 + minus_three);
        tmp_5 *= (lagrange_last + minus_one);
        tmp_5 *= scaling_factor;
        std::get<4>(accumulators) += tmp_5;

        // Contribution (6) (Contributions 6-10 ensure that the last value is the designated maximum value. We don't
        // need to constrain the first value to be 0, because the shift mechanic does this for us)
        std::get<5>(accumulators) +=
            lagrange_last * (ordered_range_constraints_0 + maximum_sort_value) * scaling_factor;
        // Contribution (7)
        std::get<6>(accumulators) +=
            lagrange_last * (ordered_range_constraints_1 + maximum_sort_value) * scaling_factor;
        // Contribution (8)
        std::get<7>(accumulators) +=
            lagrange_last * (ordered_range_constraints_2 + maximum_sort_value) * scaling_factor;
        // Contribution (9)
        std::get<8>(accumulators) +=
            lagrange_last * (ordered_range_constraints_3 + maximum_sort_value) * scaling_factor;
        // Contribution (10)
        std::get<9>(accumulators) +=
            lagrange_last * (ordered_range_constraints_4 + maximum_sort_value) * scaling_factor;
    };
};
template <typename FF> using GenPermSortRelation = Relation<GenPermSortRelationImpl<FF>>;
template <typename FF>
using GoblinTranslatorGenPermSortRelation = Relation<GoblinTranslatorGenPermSortRelationImpl<FF>>;

} // namespace proof_system
